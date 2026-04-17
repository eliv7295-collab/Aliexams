const questionBuilder = document.getElementById("questionBuilder");
let questionCounter = 0;

function addQuestionBlock(type) {
  questionCounter++;
  const div = document.createElement("div");
  div.className = "question-block";
  div.dataset.type = type;

  div.innerHTML = `
    <h3>${type.toUpperCase()} Question</h3>
    <label>Question Prompt</label>
    <textarea class="q-prompt" placeholder="Enter the question"></textarea>

    ${type === "mcq" ? `
      <label>Options (one per line)</label>
      <textarea class="q-options" placeholder="Option A\nOption B\nOption C\nOption D"></textarea>
      <label>Correct Answer</label>
      <input class="q-correct" placeholder="Must exactly match one option" />
    ` : ""}

    <label>Points</label>
    <input class="q-points" type="number" min="1" value="5" />

    <button type="button" onclick="this.parentElement.remove()">Remove</button>
  `;

  questionBuilder.appendChild(div);
}

document.getElementById("addMcqBtn").addEventListener("click", () => addQuestionBlock("mcq"));
document.getElementById("addFrqBtn").addEventListener("click", () => addQuestionBlock("frq"));

document.getElementById("createExamBtn").addEventListener("click", async () => {
  const title = document.getElementById("examTitleInput").value.trim();
  const description = document.getElementById("examDescriptionInput").value.trim();

  const questionBlocks = [...document.querySelectorAll("#questionBuilder .question-block")];
  const questions = questionBlocks.map((block) => {
    const type = block.dataset.type;
    const prompt = block.querySelector(".q-prompt").value.trim();
    const points = Number(block.querySelector(".q-points").value);

    if (type === "mcq") {
      const options = block.querySelector(".q-options").value
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);

      const correctAnswer = block.querySelector(".q-correct").value.trim();
      return { type, prompt, points, options, correctAnswer };
    }

    return { type, prompt, points };
  }).filter(q => q.prompt && q.points > 0);

  const res = await fetch("/api/admin/exams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, questions })
  });

  const result = await res.json();
  document.getElementById("createExamResult").innerHTML = `
    <div class="result">${result.message || result.error} ${result.examId ? `(Exam ID: ${result.examId})` : ""}</div>
  `;

  loadSubmissions();
});

async function loadSubmissions() {
  const res = await fetch("/api/admin/submissions");
  const submissions = await res.json();
  const list = document.getElementById("submissionList");

  if (!submissions.length) {
    list.innerHTML = "<p>No submissions yet.</p>";
    return;
  }

  list.innerHTML = submissions.map(s => `
    <div class="submission-item">
      <strong>${s.student_name}</strong><br />
      Exam: ${s.exam_title}<br />
      Score: ${s.total_score}/${s.max_score}<br />
      Submitted: ${s.submitted_at}<br />
      <button onclick="openSubmission(${s.id})">Open</button>
    </div>
  `).join("");
}

async function openSubmission(submissionId) {
  const res = await fetch(`/api/admin/submissions/${submissionId}`);
  const data = await res.json();

  document.getElementById("gradeSection").classList.remove("hidden");

  const frqBlocks = data.answers.map((a, index) => {
    if (a.type === "mcq") {
      return `
        <div class="question-block">
          <h3>Q${index + 1}. ${a.prompt} (${a.points} pts)</h3>
          <p><strong>Student Answer:</strong> ${a.answer_text || "-"}</p>
          <p><strong>Correct Answer:</strong> ${a.correct_answer}</p>
          <p><strong>Awarded:</strong> ${a.awarded_points}</p>
        </div>
      `;
    }

    return `
      <div class="question-block">
        <h3>Q${index + 1}. ${a.prompt} (${a.points} pts)</h3>
        <p><strong>Student Answer:</strong></p>
        <div class="result">${(a.answer_text || "-").replace(/</g, "&lt;")}</div>
        <label>Assign Score (0 - ${a.points})</label>
        <input type="number" min="0" max="${a.points}" value="${a.awarded_points}" data-question-id="${a.question_id}" class="frq-grade-input" />
      </div>
    `;
  }).join("");

  document.getElementById("gradeContent").innerHTML = `
    <div class="result">
      <strong>${data.student_name}</strong><br />
      Exam: ${data.exam_title}<br />
      Current Score: ${data.total_score}/${data.max_score}
    </div>
    ${frqBlocks}
    <button id="saveGradesBtn">Save FRQ Grades</button>
  `;

  document.getElementById("saveGradesBtn").onclick = async () => {
    const inputs = [...document.querySelectorAll(".frq-grade-input")];
    const grades = {};

    inputs.forEach(input => {
      grades[input.dataset.questionId] = Number(input.value);
    });

    const gradeRes = await fetch(`/api/admin/submissions/${submissionId}/grade-frq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grades })
    });

    const gradeResult = await gradeRes.json();
    alert(`Updated total score: ${gradeResult.submission.total_score}/${gradeResult.submission.max_score}`);
    loadSubmissions();
    openSubmission(submissionId);
  };
}

loadSubmissions();