# ExamHall — Online Examination System (Zero-Dependency Version)

No `npm install` needed. No native modules, no build tools, no PowerShell
execution-policy headaches. Just Node.js's built-in modules — run it with
one command.

## Stack
- **Backend:** plain Node.js `http` module (no Express)
- **Database:** a single JSON file (`data/exam-db.json`), auto-created on first run
- **Passwords:** hashed with Node's built-in `crypto.scrypt` (no bcrypt)
- **Sessions:** in-memory, cookie-based (no express-session)
- **Frontend:** static HTML + vanilla JS calling a small JSON API (no React/EJS/build step)

## Run it

```bash
node server.js
```

That's it — one command, nothing to install. Then open:

```
http://localhost:3000
```

Demo accounts are created automatically the first time you run it:

| Role    | Email              | Password   |
|---------|--------------------|------------|
| Admin (Teacher) | admin@exam.com     | admin123   |
| Student | student@exam.com   | student123 |

12 sample questions and one published demo exam ("Web Development
Fundamentals") are seeded too, so you can try the full flow immediately.

### If port 3000 is already in use
```bash
set PORT=3001 && node server.js        # Windows cmd
$env:PORT=3001; node server.js         # Windows PowerShell
PORT=3001 node server.js               # macOS/Linux
```

## Features

**Registration & roles**
- One registration form, choose **Student** or **Teacher / Admin** — routes you
  to the right dashboard automatically, on both registration and every future login
- Username, email, password, confirm password
- Teachers land on the admin dashboard; students land on their exam dashboard

**Teacher / Admin**
- Dashboard with question/exam/student/attempt stats
- **Subjects**: create a subject (e.g. "Mathematics", "Web Development")
  first, then add questions or build a quiz under it directly from the
  Subjects page
- Question bank: create, edit, delete MCQs — pick an existing subject or type
  a new one (it's added to Subjects automatically), set difficulty
  (Easy/Medium/Hard)
- Exam builder: pick a Subject + Difficulty for the quiz, then select
  questions from the bank (the picker auto-narrows to that subject as you
  type), set duration, publish/unpublish
- Per-exam leaderboard of completed attempts

**Student**
- Browse exams, **filter by Subject and by Difficulty** (Easy/Medium/Hard) —
  pick what kind of quiz to take
- Take a timed test with a live countdown, answers auto-saved as you click,
  progress bar
- Auto-submits when time runs out; auto-grades on submit
- Review a completed attempt with per-question correct/incorrect breakdown
- Full results history

## Project structure

```
online-exam-system/
├── server.js          # HTTP server + JSON API + static file serving + auto-seed
├── auth.js             # password hashing (crypto.scrypt) + in-memory sessions
├── db.js                # tiny JSON-file read/write helper
├── data/
│   └── exam-db.json      # auto-created — all your data lives here
└── public/                # everything the browser loads
    ├── style.css
    ├── api.js              # shared fetch() helpers + header/nav rendering
    ├── login.html / register.html
    ├── index.html           # student dashboard
    ├── exam.html             # take a test
    ├── result.html / results.html
    └── admin*.html            # admin dashboard, question bank, exam builder, results
```

## How grading works

Correct answers are never sent to the browser while a test is in progress —
only question text and options. Every answer you pick is auto-saved to
`data/exam-db.json` via `POST /api/attempts/:id/answer`. When you submit (or
the timer hits zero and the page auto-submits), the server recomputes the
score by comparing what's stored against each question's `correct_option`,
so it can't be tampered with from the browser console.

## Resetting the data
Delete `data/exam-db.json` and restart the server — it will reseed the demo
accounts and questions automatically.

## Notes
- This is a single-process app with an in-memory session store — restarting
  the server logs everyone out (their accounts and data are still there,
  just their session).
- Every exam question is worth 1 mark for simplicity.
- Fine for local use, a school project, or a small internal deployment. For
  production with many concurrent users, swap the JSON file for a real
  database.
