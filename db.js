const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'exam-db.json');

function emptyDb() {
  return {
    nextId: { users: 1, questions: 1, exams: 1, attempts: 1, subjects: 1, mcq_sets: 1 },
    users: [],
    subjects: [],
    questions: [],
    exams: [],
    attempts: [],
    mcq_sets: [],
  };
}

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyDb();
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (!raw.trim()) return emptyDb();
    const parsed = JSON.parse(raw);
    const base = emptyDb();
    const result = Object.assign(base, parsed);
    // Ensure mcq_sets exists in older DBs
    if (!result.mcq_sets) result.mcq_sets = [];
    if (!result.nextId.mcq_sets) result.nextId.mcq_sets = 1;
    return result;
  } catch (err) {
    console.error('Failed to read database file, starting fresh:', err.message);
    return emptyDb();
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(db, kind) {
  const id = db.nextId[kind] || 1;
  db.nextId[kind] = id + 1;
  return id;
}

module.exports = { load, save, nextId, DATA_FILE };
