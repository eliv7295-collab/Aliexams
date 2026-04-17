const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const db = new Database("exam.db");
const PORT = 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// --------------------
// Database setup
// --------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('mcq', 'frq')),
    prompt TEXT NOT NULL,
    options_json TEXT,
    correct_answer TEXT,
    points INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (exam_id) REFERENCES exams(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    mcq_score INTEGER NOT NULL DEFAULT 0,
    frq_score INTEGER NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0,
    max_score INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT NOT NULL,
    graded_at TEXT,
    FOREIGN KEY (exam_id) REFERENCES exams(id)
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    answer_text TEXT,
    auto_correct INTEGER DEFAULT NULL,
    awarded_points INTEGER DEFAULT 0,
    FOREIGN KEY (submission_id) REFERENCES submissions(id),
    FOREIGN KEY (question_id) REFERENCES questions(id)
  );
`);

// Seed sample exam if empty
const examCount = db.prepare("SELECT COUNT(*) as count FROM exams").get().count;
if (examCount === 0) {
  const insertExam = db.prepare("INSERT INTO exams (title, description) VALUES (?, ?)");
  const examInfo = insertExam.run("Sample Math Exam", "Demo exam with MCQ and FRQ");
  const examId = examInfo.lastInsertRowid;

  const insertQuestion = db.prepare(`
    INSERT INTO questions (exam_id, type, prompt, options_json, correct_answer, points)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertQuestion.run(
    examId,
    "mcq",
    "What is 2 + 2?",
    JSON.stringify(["2", "3", "4", "5"]),
    "4",
    5
  );

  insertQuestion.run(
    examId,
    "mcq",
    "Which planet is known as the Red Planet?",
    JSON.stringify(["Earth", "Mars", "Jupiter", "Venus"]),
    "Mars",
    5
  );

  insertQuestion.run(
    examId,
    "frq",
    "Explain the Pythagorean theorem in your own words.",
    null,
    null,
    10
  );
}

function getExamWithQuestions(examId) {
  const exam = db.prepare("SELECT * FROM exams WHERE id = ?").get(examId);
  if (!exam) return null;

  const questions = db.prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY id ASC").all(examId)
    .map((q) => ({
      ...q,
      options: q.options_json ? JSON.parse(q.options_json) : null,
      options_json: undefined,
      correct_answer: undefined // hide correct answer from student API
    }));

  return { ...exam, questions };
}

function calculateMaxScore(examId) {
  const row = db.prepare("SELECT COALESCE(SUM(points), 0) as total FROM questions WHERE exam_id = ?").get(examId);
  return row.total;
}

function recalculateSubmissionTotal(submissionId) {
  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId);
  if (!submission) return;

  const scores = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN q.type = 'mcq' THEN a.awarded_points ELSE 0 END), 0) as mcq_score,
      COALESCE(SUM(CASE WHEN q.type = 'frq' THEN a.awarded_points ELSE 0 END), 0) as frq_score
    FROM answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.submission_id = ?
  `).get(submissionId);

  db.prepare(`
    UPDATE submissions
    SET mcq_score = ?,
        frq_score = ?,
        total_score = ?,
        graded_at = datetime('now')
    WHERE id = ?
  `).run(scores.mcq_score, scores.frq_score, scores.mcq_score + scores.frq_score, submissionId);
}

// --------------------
// Student APIs
// --------------------
app.get("/api/exams", (req, res) => {
  const exams = db.prepare("SELECT id, title, description FROM exams ORDER BY id DESC").all();
  res.json(exams);
});

app.get("/api/exams/:id", (req, res) => {
  const exam = getExamWithQuestions(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

app.post("/api/exams/:id/submit", (req, res) => {
  const examId = Number(req.params.id);
  const { studentName, answers } = req.body;

  if (!studentName || !answers || typeof answers !== "object") {
    return res.status(400).json({ error: "studentName and answers are required" });
  }

  const exam = db.prepare("SELECT * FROM exams WHERE id = ?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const questions = db.prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY id ASC").all(examId);
  const maxScore = calculateMaxScore(examId);

  const insertSubmission = db.prepare(`
    INSERT INTO submissions (exam_id, student_name, mcq_score, frq_score, total_score, max_score, submitted_at)
    VALUES (?, ?, 0, 0, 0, ?, datetime('now'))
  `);
  const submissionInfo = insertSubmission.run(examId, studentName, maxScore);
  const submissionId = submissionInfo.lastInsertRowid;

  const insertAnswer = db.prepare(`
    INSERT INTO answers (submission_id, question_id, answer_text, auto_correct, awarded_points)
    VALUES (?, ?, ?, ?, ?)
  `);

  let mcqScore = 0;

  for (const question of questions) {
    const studentAnswer = answers[String(question.id)] ?? "";

    if (question.type === "mcq") {
      const isCorrect = String(studentAnswer).trim() === String(question.correct_answer).trim();
      const awarded = isCorrect ? question.points : 0;
      mcqScore += awarded;
      insertAnswer.run(submissionId, question.id, String(studentAnswer), isCorrect ? 1 : 0, awarded);
    } else {
      insertAnswer.run(submissionId, question.id, String(studentAnswer), null, 0);
    }
  }

  db.prepare(`
    UPDATE submissions
    SET mcq_score = ?, total_score = ?
    WHERE id = ?
  `).run(mcqScore, mcqScore, submissionId);

  res.json({
    message: "Exam submitted successfully",
    submissionId,
    mcqScore,
    totalScore: mcqScore,
    maxScore,
    note: "FRQ will be graded later by admin"
  });
});

// --------------------
// Admin APIs
// --------------------
app.post("/api/admin/exams", (req, res) => {
  const { title, description, questions } = req.body;

  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "Title and at least one question are required" });
  }

  const examInfo = db.prepare("INSERT INTO exams (title, description) VALUES (?, ?)").run(title, description || "");
  const examId = examInfo.lastInsertRowid;

  const insertQuestion = db.prepare(`
    INSERT INTO questions (exam_id, type, prompt, options_json, correct_answer, points)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const q of questions) {
    if (!q.type || !q.prompt || !q.points) continue;

    insertQuestion.run(
      examId,
      q.type,
      q.prompt,
      q.type === "mcq" ? JSON.stringify(q.options || []) : null,
      q.type === "mcq" ? (q.correctAnswer || "") : null,
      Number(q.points)
    );
  }

  res.json({ message: "Exam created", examId });
});

app.get("/api/admin/submissions", (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, e.title as exam_title
    FROM submissions s
    JOIN exams e ON e.id = s.exam_id
    ORDER BY s.id DESC
  `).all();

  res.json(rows);
});

app.get("/api/admin/submissions/:id", (req, res) => {
  const submissionId = Number(req.params.id);

  const submission = db.prepare(`
    SELECT s.*, e.title as exam_title
    FROM submissions s
    JOIN exams e ON e.id = s.exam_id
    WHERE s.id = ?
  `).get(submissionId);

  if (!submission) return res.status(404).json({ error: "Submission not found" });

  const answers = db.prepare(`
    SELECT
      a.id as answer_id,
      a.answer_text,
      a.auto_correct,
      a.awarded_points,
      q.id as question_id,
      q.type,
      q.prompt,
      q.points,
      q.correct_answer,
      q.options_json
    FROM answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.submission_id = ?
    ORDER BY q.id ASC
  `).all(submissionId).map((row) => ({
    ...row,
    options: row.options_json ? JSON.parse(row.options_json) : null,
    options_json: undefined
  }));

  res.json({ ...submission, answers });
});

app.post("/api/admin/submissions/:id/grade-frq", (req, res) => {
  const submissionId = Number(req.params.id);
  const { grades } = req.body;

  if (!grades || typeof grades !== "object") {
    return res.status(400).json({ error: "grades object is required" });
  }

  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId);
  if (!submission) return res.status(404).json({ error: "Submission not found" });

  const getQuestion = db.prepare("SELECT * FROM questions WHERE id = ?");
  const updateAnswer = db.prepare(`
    UPDATE answers SET awarded_points = ?
    WHERE submission_id = ? AND question_id = ?
  `);

  for (const [questionId, score] of Object.entries(grades)) {
    const q = getQuestion.get(Number(questionId));
    if (!q || q.type !== "frq") continue;

    const numericScore = Math.max(0, Math.min(Number(score), Number(q.points)));
    updateAnswer.run(numericScore, submissionId, Number(questionId));
  }

  recalculateSubmissionTotal(submissionId);

  const updated = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId);
  res.json({ message: "FRQ graded", submission: updated });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});