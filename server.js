const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const db = require('./db');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
function ensureSeeded() {
  const data = db.load();
  if (data.users.length > 0) return;

  const admin = auth.makeCredentials('admin123');
  data.users.push({ id: db.nextId(data, 'users'), name: 'Admin', email: 'admin@exam.com', role: 'admin', salt: admin.salt, passwordHash: admin.passwordHash, createdAt: new Date().toISOString() });

  const student = auth.makeCredentials('student123');
  data.users.push({ id: db.nextId(data, 'users'), name: 'Demo Student', email: 'student@exam.com', role: 'student', salt: student.salt, passwordHash: student.passwordHash, createdAt: new Date().toISOString() });

  const sample = [
    ['What does HTML stand for?', 'Hyper Trainer Marking Language', 'Hyper Text Markup Language', 'Hyper Text Marketing Language', 'Hyper Tool Multi Language', 'B', 'Web Development', 'Easy'],
    ['Which CSS property controls text size?', 'font-weight', 'text-style', 'font-size', 'text-size', 'C', 'Web Development', 'Easy'],
    ['Which of these is NOT a JavaScript data type?', 'Number', 'Boolean', 'Float', 'String', 'C', 'Web Development', 'Medium'],
    ['In PHP, which symbol is used to declare a variable?', '@', '$', '#', '&', 'B', 'PHP', 'Easy'],
    ['Which SQL statement is used to extract data from a database?', 'GET', 'OPEN', 'SELECT', 'EXTRACT', 'C', 'Database', 'Easy'],
    ['What does SQL stand for?', 'Structured Query Language', 'Strong Question Language', 'Structured Question Logic', 'Simple Query Language', 'A', 'Database', 'Easy'],
    ['Which HTTP method is typically used to update a resource?', 'GET', 'PUT', 'DELETE', 'FETCH', 'B', 'Web Development', 'Medium'],
    ['What is the time complexity of binary search?', 'O(n)', 'O(n log n)', 'O(log n)', 'O(1)', 'C', 'Computer Science', 'Medium'],
    ['Which of these is a NoSQL database?', 'MySQL', 'PostgreSQL', 'MongoDB', 'SQLite', 'C', 'Database', 'Easy'],
    ['In Node.js, which module creates a web server?', 'fs', 'http', 'path', 'os', 'B', 'Node.js', 'Medium'],
    ['Which company developed Java?', 'Microsoft', 'Sun Microsystems', 'Apple', 'IBM', 'B', 'Computer Science', 'Medium'],
    ['What does API stand for?', 'Application Programming Interface', 'Advanced Programming Interface', 'Application Process Integration', 'Automated Program Interaction', 'A', 'Computer Science', 'Easy'],
  ];

  const subjectNames = [...new Set(sample.map((r) => r[6]))];
  const subjectIdByName = {};
  subjectNames.forEach((name) => {
    const id = db.nextId(data, 'subjects');
    subjectIdByName[name] = id;
    data.subjects.push({ id, name, created_by: 1, createdAt: new Date().toISOString() });
  });

  const questionIds = sample.map((row) => {
    const id = db.nextId(data, 'questions');
    data.questions.push({ id, question_text: row[0], option_a: row[1], option_b: row[2], option_c: row[3], option_d: row[4], correct_option: row[5], category: row[6], difficulty: row[7], created_by: 1, createdAt: new Date().toISOString() });
    return id;
  });

  data.exams.push({ id: db.nextId(data, 'exams'), title: 'Web Development Fundamentals', description: 'A quick quiz covering HTML, CSS, JS, PHP and databases.', subject: 'Web Development', difficulty: 'Medium', duration_minutes: 15, is_published: true, question_ids: questionIds.slice(0, 8), created_by: 1, createdAt: new Date().toISOString() });

  // Ensure nextId for mcq_sets
  if (!data.nextId.mcq_sets) data.nextId.mcq_sets = 1;
  if (!data.mcq_sets) data.mcq_sets = [];

  db.save(data);
  console.log('Seeded demo data: admin@exam.com/admin123, student@exam.com/student123');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `session_token=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 8}; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=UTF-8' });
  res.end(body);
}

function sendStatic(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) { sendText(res, 404, 'Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks += chunk;
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try { resolve(JSON.parse(chunks)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('File too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const session = auth.getSession(cookies.session_token);
  if (!session) return null;
  const data = db.load();
  const user = data.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------
function gradeAttempt(data, attempt) {
  const exam = data.exams.find((e) => e.id === attempt.exam_id);
  const questions = exam.question_ids.map((qid) => data.questions.find((q) => q.id === qid)).filter(Boolean);
  let score = 0;
  const totalMarks = questions.length;
  const breakdown = questions.map((q) => {
    const selected = attempt.answers[q.id] || null;
    const isCorrect = selected != null && selected === q.correct_option;
    if (isCorrect) score += 1;
    return { question_id: q.id, selected_option: selected, is_correct: isCorrect };
  });
  attempt.status = 'completed';
  attempt.end_time = new Date().toISOString();
  attempt.score = score;
  attempt.total_marks = totalMarks;
  attempt.breakdown = breakdown;
  return attempt;
}

function attemptRemainingMs(attempt, exam) {
  const elapsed = Date.now() - new Date(attempt.start_time).getTime();
  return exam.duration_minutes * 60000 - elapsed;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const user = currentUser(req);

  const requireAuth = () => { if (!user) { sendJson(res, 401, { error: 'Not logged in.' }); return false; } return true; };
  const requireRole = (role) => {
    if (!user) { sendJson(res, 401, { error: 'Not logged in.' }); return false; }
    if (user.role !== role) { sendJson(res, 403, { error: `This action is for ${role}s only.` }); return false; }
    return true;
  };

  // ---- Auth ----
  if (pathname === '/api/register' && method === 'POST') {
    const body = await parseBody(req);
    const { name, email, password } = body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const role = body.role === 'teacher' ? 'admin' : 'student';
    if (!name || !cleanEmail || !password) return sendJson(res, 400, { error: 'All fields are required.' });
    if (!auth.isValidEmail(cleanEmail)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    if (String(password).length < 6) return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
    const data = db.load();
    if (data.users.some((u) => u.email === cleanEmail)) return sendJson(res, 400, { error: 'An account with this email already exists.' });
    if (data.users.some((u) => u.name.toLowerCase() === String(name).trim().toLowerCase())) return sendJson(res, 400, { error: 'That username is already taken.' });
    const creds = auth.makeCredentials(password);
    const newUser = { id: db.nextId(data, 'users'), name: String(name).trim(), email: cleanEmail, role, salt: creds.salt, passwordHash: creds.passwordHash, createdAt: new Date().toISOString() };
    data.users.push(newUser);
    db.save(data);
    return sendJson(res, 200, { user: publicUser(newUser) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const body = await parseBody(req);
    const cleanEmail = (body.email || '').trim().toLowerCase();
    const data = db.load();
    const foundUser = data.users.find((u) => u.email === cleanEmail);
    if (!foundUser || !auth.verifyPassword(body.password || '', foundUser.salt, foundUser.passwordHash)) return sendJson(res, 401, { error: 'Incorrect email or password.' });
    const token = auth.createSession(foundUser.id);
    setSessionCookie(res, token);
    return sendJson(res, 200, { user: publicUser(foundUser) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const cookies = parseCookies(req);
    auth.destroySession(cookies.session_token);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    if (!user) return sendJson(res, 401, { error: 'Not logged in.' });
    return sendJson(res, 200, { user });
  }

  // ---- Subjects ----
  if (pathname === '/api/subjects' && method === 'GET') {
    if (!requireAuth()) return;
    const data = db.load();
    const subjects = data.subjects.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
      ...s,
      question_count: data.questions.filter((q) => q.category === s.name).length,
      exam_count: data.exams.filter((e) => e.subject === s.name).length,
    }));
    return sendJson(res, 200, { subjects });
  }

  if (pathname === '/api/admin/subjects' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await parseBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Subject name is required.' });
    const data = db.load();
    if (data.subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) return sendJson(res, 400, { error: 'That subject already exists.' });
    const subject = { id: db.nextId(data, 'subjects'), name, created_by: user.id, createdAt: new Date().toISOString() };
    data.subjects.push(subject);
    db.save(data);
    return sendJson(res, 200, { subject });
  }

  const subjectIdMatch = pathname.match(/^\/api\/admin\/subjects\/(\d+)$/);
  if (subjectIdMatch && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const idx = data.subjects.findIndex((s) => s.id === Number(subjectIdMatch[1]));
    if (idx === -1) return sendJson(res, 404, { error: 'Subject not found.' });
    data.subjects.splice(idx, 1);
    db.save(data);
    return sendJson(res, 200, { ok: true });
  }

  // ---- Admin: Questions ----
  if (pathname === '/api/admin/questions' && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const category = query.get('category');
    // Shared question bank: every admin sees every subject's questions, grouped by category.
    let questions = data.questions.slice().sort((a, b) => b.id - a.id);
    if (category) questions = questions.filter((q) => q.category === category);
    const categories = [...new Set(data.questions.map((q) => q.category))].sort();
    return sendJson(res, 200, { questions, categories });
  }

  if (pathname === '/api/admin/questions' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await parseBody(req);
    const err = validateQuestion(body);
    if (err) return sendJson(res, 400, { error: err });
    const data = db.load();
    const category = ensureSubjectExists(data, body.category, user.id);
    const question = { id: db.nextId(data, 'questions'), question_text: body.question_text.trim(), option_a: body.option_a.trim(), option_b: body.option_b.trim(), option_c: body.option_c.trim(), option_d: body.option_d.trim(), correct_option: body.correct_option, category, difficulty: body.difficulty || 'Medium', created_by: user.id, createdAt: new Date().toISOString() };
    data.questions.push(question);
    db.save(data);
    return sendJson(res, 200, { question });
  }

  const questionMatch = pathname.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (questionMatch && (method === 'PUT' || method === 'DELETE')) {
    if (!requireRole('admin')) return;
    const id = Number(questionMatch[1]);
    const data = db.load();
    const idx = data.questions.findIndex((q) => q.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Question not found.' });
    // Shared bank: any admin can manage any question.
    if (method === 'DELETE') {
      data.questions.splice(idx, 1);
      data.exams.forEach((exam) => { exam.question_ids = exam.question_ids.filter((qid) => qid !== id); });
      db.save(data);
      return sendJson(res, 200, { ok: true });
    }
    const body = await parseBody(req);
    const err = validateQuestion(body);
    if (err) return sendJson(res, 400, { error: err });
    const category = ensureSubjectExists(data, body.category, user.id);
    data.questions[idx] = { ...data.questions[idx], question_text: body.question_text.trim(), option_a: body.option_a.trim(), option_b: body.option_b.trim(), option_c: body.option_c.trim(), option_d: body.option_d.trim(), correct_option: body.correct_option, category, difficulty: body.difficulty || 'Medium' };
    db.save(data);
    return sendJson(res, 200, { question: data.questions[idx] });
  }

  const bulkDeleteMatch = pathname === '/api/admin/questions/bulk-delete';
  if (bulkDeleteMatch && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await parseBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    if (ids.length === 0) return sendJson(res, 400, { error: 'No question ids supplied.' });
    const data = db.load();
    data.questions = data.questions.filter((q) => !ids.includes(q.id));
    data.exams.forEach((exam) => { exam.question_ids = exam.question_ids.filter((qid) => !ids.includes(qid)); });
    db.save(data);
    return sendJson(res, 200, { ok: true, deleted: ids.length });
  }

  const duplicateMatch = pathname.match(/^\/api\/admin\/questions\/(\d+)\/duplicate$/);
  if (duplicateMatch && method === 'POST') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const source = data.questions.find((q) => q.id === Number(duplicateMatch[1]));
    if (!source) return sendJson(res, 404, { error: 'Question not found.' });
    const clone = { ...source, id: db.nextId(data, 'questions'), question_text: `${source.question_text} (copy)`, created_by: user.id, createdAt: new Date().toISOString() };
    data.questions.push(clone);
    db.save(data);
    return sendJson(res, 200, { question: clone });
  }

  // ---- Admin: Exams ----
  if (pathname === '/api/admin/exams' && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const exams = data.exams.slice().sort((a, b) => b.id - a.id).map((exam) => ({ ...exam, question_count: exam.question_ids.length, attempt_count: data.attempts.filter((a) => a.exam_id === exam.id && a.status === 'completed').length }));
    return sendJson(res, 200, { exams });
  }

  if (pathname === '/api/admin/exams' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await parseBody(req);
    const err = validateExam(body);
    if (err) return sendJson(res, 400, { error: err });
    const data = db.load();
    const subject = ensureSubjectExists(data, body.subject, user.id);
    const exam = { id: db.nextId(data, 'exams'), title: body.title.trim(), description: (body.description || '').trim(), subject, difficulty: ['Easy', 'Medium', 'Hard'].includes(body.difficulty) ? body.difficulty : 'Medium', duration_minutes: Number(body.duration_minutes), is_published: !!body.is_published, question_ids: body.question_ids.map(Number), created_by: user.id, createdAt: new Date().toISOString() };
    data.exams.push(exam);
    db.save(data);
    return sendJson(res, 200, { exam });
  }

  const examIdMatch = pathname.match(/^\/api\/admin\/exams\/(\d+)$/);
  if (examIdMatch && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const exam = data.exams.find((e) => e.id === Number(examIdMatch[1]));
    if (!exam) return sendJson(res, 404, { error: 'Exam not found.' });
    return sendJson(res, 200, { exam });
  }

  if (examIdMatch && (method === 'PUT' || method === 'DELETE')) {
    if (!requireRole('admin')) return;
    const id = Number(examIdMatch[1]);
    const data = db.load();
    const idx = data.exams.findIndex((e) => e.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Exam not found.' });
    if (method === 'DELETE') {
      data.exams.splice(idx, 1);
      data.attempts = data.attempts.filter((a) => a.exam_id !== id);
      db.save(data);
      return sendJson(res, 200, { ok: true });
    }
    const body = await parseBody(req);
    const err = validateExam(body);
    if (err) return sendJson(res, 400, { error: err });
    const subject = ensureSubjectExists(data, body.subject, user.id);
    data.exams[idx] = { ...data.exams[idx], title: body.title.trim(), description: (body.description || '').trim(), subject, difficulty: ['Easy', 'Medium', 'Hard'].includes(body.difficulty) ? body.difficulty : 'Medium', duration_minutes: Number(body.duration_minutes), is_published: !!body.is_published, question_ids: body.question_ids.map(Number) };
    db.save(data);
    return sendJson(res, 200, { exam: data.exams[idx] });
  }

  const examResultsMatch = pathname.match(/^\/api\/admin\/exams\/(\d+)\/results$/);
  if (examResultsMatch && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const exam = data.exams.find((e) => e.id === Number(examResultsMatch[1]));
    if (!exam) return sendJson(res, 404, { error: 'Exam not found.' });
    const attempts = data.attempts.filter((a) => a.exam_id === exam.id && a.status === 'completed').map((a) => {
      const student = data.users.find((u) => u.id === a.user_id);
      return { id: a.id, score: a.score, total_marks: a.total_marks, end_time: a.end_time, student_name: student ? student.name : 'Unknown', student_email: student ? student.email : '' };
    }).sort((a, b) => b.score - a.score || new Date(a.end_time) - new Date(b.end_time));
    return sendJson(res, 200, { exam, attempts });
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = db.load();
    const completedAttempts = data.attempts.filter((a) => a.status === 'completed');
    const recentAttempts = completedAttempts.slice().sort((a, b) => new Date(b.end_time) - new Date(a.end_time)).slice(0, 8).map((a) => {
      const exam = data.exams.find((e) => e.id === a.exam_id);
      const student = data.users.find((u) => u.id === a.user_id);
      return { id: a.id, score: a.score, total_marks: a.total_marks, end_time: a.end_time, exam_title: exam ? exam.title : 'Deleted exam', student_name: student ? student.name : 'Unknown' };
    });
    return sendJson(res, 200, { stats: { questionCount: data.questions.length, examCount: data.exams.length, mcqSetCount: (data.mcq_sets || []).length, studentCount: data.users.filter((u) => u.role === 'student').length, attemptCount: completedAttempts.length }, recentAttempts });
  }

  // ---- Admin: MCQ Sets (PDF-based quiz sets) ----
  if (pathname === '/api/admin/mcq-sets' && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = db.load();
    if (!data.mcq_sets) data.mcq_sets = [];
    const sets = data.mcq_sets.slice().sort((a, b) => b.id - a.id);
    return sendJson(res, 200, { mcq_sets: sets });
  }

  if (pathname === '/api/admin/mcq-sets' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await parseBody(req);
    if (!body.title || !body.subject) return sendJson(res, 400, { error: 'Title and subject are required.' });
    if (!Array.isArray(body.questions) || body.questions.length === 0) return sendJson(res, 400, { error: 'At least one question required.' });
    const data = db.load();
    if (!data.mcq_sets) data.mcq_sets = [];
    if (!data.nextId.mcq_sets) data.nextId.mcq_sets = 1;
    const mcqSet = { id: db.nextId(data, 'mcq_sets'), title: body.title.trim(), subject: body.subject.trim(), description: (body.description || '').trim(), questions: body.questions, created_by: user.id, createdAt: new Date().toISOString() };
    data.mcq_sets.push(mcqSet);
    db.save(data);
    return sendJson(res, 200, { mcq_set: mcqSet });
  }

  const mcqSetMatch = pathname.match(/^\/api\/admin\/mcq-sets\/(\d+)$/);
  if (mcqSetMatch && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const data = db.load();
    if (!data.mcq_sets) data.mcq_sets = [];
    const idx = data.mcq_sets.findIndex((s) => s.id === Number(mcqSetMatch[1]));
    if (idx === -1) return sendJson(res, 404, { error: 'MCQ set not found.' });
    data.mcq_sets.splice(idx, 1);
    db.save(data);
    return sendJson(res, 200, { ok: true });
  }

  // ---- Student: MCQ Bank (subject-wise practice) ----
  if (pathname === '/api/mcq-subjects' && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const subjects = data.subjects.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
      ...s,
      question_count: data.questions.filter((q) => q.category === s.name).length,
      mcq_set_count: (data.mcq_sets || []).filter((ms) => ms.subject === s.name).length,
    })).filter((s) => s.question_count > 0 || s.mcq_set_count > 0);
    return sendJson(res, 200, { subjects });
  }

  if (pathname === '/api/mcq-bank' && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const subject = query.get('subject');
    let questions = data.questions;
    if (subject) questions = questions.filter((q) => q.category === subject);
    const safeQuestions = questions.map((q) => ({ id: q.id, question_text: q.question_text, option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d, correct_option: q.correct_option, category: q.category, difficulty: q.difficulty }));
    const mcqSets = (data.mcq_sets || []).filter((s) => !subject || s.subject === subject).map((s) => ({ id: s.id, title: s.title, subject: s.subject, description: s.description, question_count: s.questions.length }));
    return sendJson(res, 200, { questions: safeQuestions, mcq_sets: mcqSets });
  }

  const mcqSetStudentMatch = pathname.match(/^\/api\/mcq-sets\/(\d+)$/);
  if (mcqSetStudentMatch && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const set = (data.mcq_sets || []).find((s) => s.id === Number(mcqSetStudentMatch[1]));
    if (!set) return sendJson(res, 404, { error: 'MCQ set not found.' });
    return sendJson(res, 200, { mcq_set: set });
  }

  // ---- Student: Exams ----
  if (pathname === '/api/exams' && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const subjectFilter = query.get('subject');
    const difficultyFilter = query.get('difficulty');
    let published = data.exams.filter((e) => e.is_published);
    if (subjectFilter) published = published.filter((e) => e.subject === subjectFilter);
    if (difficultyFilter) published = published.filter((e) => e.difficulty === difficultyFilter);
    const exams = published.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((exam) => {
      const myAttempts = data.attempts.filter((a) => a.exam_id === exam.id && a.user_id === user.id);
      const active = myAttempts.find((a) => a.status === 'in_progress');
      return { id: exam.id, title: exam.title, description: exam.description, subject: exam.subject, difficulty: exam.difficulty, duration_minutes: exam.duration_minutes, question_count: exam.question_ids.length, attempts_taken: myAttempts.filter((a) => a.status === 'completed').length, active_attempt_id: active ? active.id : null };
    });
    const allPublished = data.exams.filter((e) => e.is_published);
    const availableSubjects = [...new Set(allPublished.map((e) => e.subject))].sort();
    const availableDifficulties = ['Easy', 'Medium', 'Hard'].filter((d) => allPublished.some((e) => e.difficulty === d));
    const recentResults = data.attempts.filter((a) => a.user_id === user.id && a.status === 'completed').sort((a, b) => new Date(b.end_time) - new Date(a.end_time)).slice(0, 5).map((a) => ({ id: a.id, score: a.score, total_marks: a.total_marks, end_time: a.end_time, title: (data.exams.find((e) => e.id === a.exam_id) || {}).title || 'Deleted exam' }));
    return sendJson(res, 200, { exams, recentResults, availableSubjects, availableDifficulties });
  }

  const startMatch = pathname.match(/^\/api\/exams\/(\d+)\/start$/);
  if (startMatch && method === 'POST') {
    if (!requireRole('student')) return;
    const examId = Number(startMatch[1]);
    const data = db.load();
    const exam = data.exams.find((e) => e.id === examId && e.is_published);
    if (!exam) return sendJson(res, 404, { error: 'Exam not found.' });
    let attempt = data.attempts.find((a) => a.exam_id === examId && a.user_id === user.id && a.status === 'in_progress');
    if (!attempt) {
      attempt = { id: db.nextId(data, 'attempts'), exam_id: examId, user_id: user.id, start_time: new Date().toISOString(), end_time: null, status: 'in_progress', answers: {}, score: null, total_marks: null };
      data.attempts.push(attempt);
      db.save(data);
    }
    return sendJson(res, 200, { attemptId: attempt.id });
  }

  const attemptMatch = pathname.match(/^\/api\/attempts\/(\d+)$/);
  if (attemptMatch && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const attempt = data.attempts.find((a) => a.id === Number(attemptMatch[1]) && a.user_id === user.id);
    if (!attempt) return sendJson(res, 404, { error: 'Attempt not found.' });
    const exam = data.exams.find((e) => e.id === attempt.exam_id);
    if (attempt.status === 'in_progress') {
      const remainingMs = attemptRemainingMs(attempt, exam);
      if (remainingMs <= 0) { gradeAttempt(data, attempt); db.save(data); }
    }
    if (attempt.status === 'completed') return sendJson(res, 200, { status: 'completed', attemptId: attempt.id });
    const questions = exam.question_ids.map((qid) => data.questions.find((q) => q.id === qid)).filter(Boolean).map((q) => ({ id: q.id, question_text: q.question_text, option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d }));
    return sendJson(res, 200, { status: 'in_progress', exam: { id: exam.id, title: exam.title, duration_minutes: exam.duration_minutes }, questions, answers: attempt.answers, remainingSeconds: Math.max(0, Math.floor(attemptRemainingMs(attempt, exam) / 1000)) });
  }

  const answerMatch = pathname.match(/^\/api\/attempts\/(\d+)\/answer$/);
  if (answerMatch && method === 'POST') {
    if (!requireRole('student')) return;
    const data = db.load();
    const attempt = data.attempts.find((a) => a.id === Number(answerMatch[1]) && a.user_id === user.id);
    if (!attempt || attempt.status !== 'in_progress') return sendJson(res, 400, { ok: false });
    const body = await parseBody(req);
    if (!['A', 'B', 'C', 'D'].includes(body.selected_option)) return sendJson(res, 400, { ok: false });
    attempt.answers[String(body.question_id)] = body.selected_option;
    db.save(data);
    return sendJson(res, 200, { ok: true });
  }

  const submitMatch = pathname.match(/^\/api\/attempts\/(\d+)\/submit$/);
  if (submitMatch && method === 'POST') {
    if (!requireRole('student')) return;
    const data = db.load();
    const attempt = data.attempts.find((a) => a.id === Number(submitMatch[1]) && a.user_id === user.id);
    if (!attempt) return sendJson(res, 404, { error: 'Attempt not found.' });
    if (attempt.status === 'in_progress') { gradeAttempt(data, attempt); db.save(data); }
    return sendJson(res, 200, { attemptId: attempt.id });
  }

  const resultMatch = pathname.match(/^\/api\/attempts\/(\d+)\/result$/);
  if (resultMatch && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const attempt = data.attempts.find((a) => a.id === Number(resultMatch[1]) && a.user_id === user.id);
    if (!attempt) return sendJson(res, 404, { error: 'Attempt not found.' });
    if (attempt.status !== 'completed') return sendJson(res, 400, { error: 'Attempt not finished yet.' });
    const exam = data.exams.find((e) => e.id === attempt.exam_id);
    const details = attempt.breakdown.map((b) => {
      const q = data.questions.find((qq) => qq.id === b.question_id);
      return { question_text: q ? q.question_text : '(deleted)', option_a: q ? q.option_a : '', option_b: q ? q.option_b : '', option_c: q ? q.option_c : '', option_d: q ? q.option_d : '', correct_option: q ? q.correct_option : null, selected_option: b.selected_option, is_correct: b.is_correct };
    });
    return sendJson(res, 200, { exam: { title: exam ? exam.title : 'Deleted exam' }, attempt: { score: attempt.score, total_marks: attempt.total_marks }, details });
  }

  if (pathname === '/api/results' && method === 'GET') {
    if (!requireRole('student')) return;
    const data = db.load();
    const results = data.attempts.filter((a) => a.user_id === user.id && a.status === 'completed').sort((a, b) => new Date(b.end_time) - new Date(a.end_time)).map((a) => ({ id: a.id, score: a.score, total_marks: a.total_marks, end_time: a.end_time, title: (data.exams.find((e) => e.id === a.exam_id) || {}).title || 'Deleted exam' }));
    return sendJson(res, 200, { results });
  }

  sendJson(res, 404, { error: 'Not found.' });
}

function ensureSubjectExists(data, name, userId) {
  const clean = (name || 'General').trim() || 'General';
  if (!data.subjects.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
    data.subjects.push({ id: db.nextId(data, 'subjects'), name: clean, created_by: userId || null, createdAt: new Date().toISOString() });
  }
  return clean;
}

function validateQuestion(q) {
  if (!q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d) return 'All fields are required.';
  if (!['A', 'B', 'C', 'D'].includes(q.correct_option)) return 'Please select a valid correct option.';
  return null;
}

function validateExam(body) {
  if (!body.title || !body.duration_minutes) return 'Title and duration are required.';
  if (!Array.isArray(body.question_ids) || body.question_ids.length === 0) return 'Select at least one question.';
  if (Number(body.duration_minutes) <= 0) return 'Duration must be a positive number.';
  return null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsedUrl.searchParams);
      return;
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) { sendText(res, 403, 'Forbidden'); return; }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) {
      const notFound = path.join(PUBLIC_DIR, '404.html');
      if (!fs.existsSync(notFound)) { sendText(res, 404, 'Not found'); return; }
      filePath = notFound;
    }
    sendStatic(res, filePath);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Server error.' });
  }
});

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
ensureSeeded();

server.listen(PORT, () => {
  console.log(`Online Examination System running at http://localhost:${PORT}`);
  console.log('Admin: admin@exam.com / admin123');
  console.log('Student: student@exam.com / student123');
});
