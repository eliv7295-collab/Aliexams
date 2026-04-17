let currentExamId = null;

async function loadExams() {
  const res = await fetch("/api/exams");
  const exams = await res.json();
  const examList = document.getElementById("examList");

  if (!exams.length) {
    examList.innerHTML = "<p>No exams available.</p>";
    return;
  }

  examList.innerHTML = exams.map(exam => `
    <div class="exam-item">
      <h3>${exam.title}</h3>
      <p>${exam.description || ""}</p>
      <button onclick="openExam(${exam.id})">Start Exam</button>
    </div>
  `).join("");
}

async function openExam(examId) {
  const res = await fetch(`/api/exams/${examId}`);
  const exam = await res.json();
  currentExamId = exam.id;

  document.getElementById("examSection").classList.remove("hidden");
  document.getElementById("examTitle").textContent = exam.title;
  document.getElementById("examDescription").textContent = exam.description || "";

  const form = document.getElementById("examForm");
  form.innerHTML = exam.questions.map((q, index) => {
    if (q.type === "mcq") {
      return `
        <div class="question-block">
          <h3>Q${index + 1}. ${q.prompt} (${q.points} pts)</h3>
          ${q.options.map(option => `
            <label>
              <input type="radio" name="question_${q.id}" value="${option}" /> ${option}
            </label>
          `).join("")}
        </div>
      `;
    }

    return `
      <div class="question-block">
        <h3>Q${index + 1}. ${q.prompt} (${q.points} pts)</h3>
        <textarea name="question_${q.id}" rows="5" placeholder="Write your answer here"></textarea>
      </div>
    `;
  }).join("");

  document.getElementById("resultBox").innerHTML = "";
}

document.getElementById("submitExamBtn").addEventListener("click", async () => {
  if (!currentExamId) return;

  const studentName = document.getElementById("studentName").value.trim();
  if (!studentName) {
    alert("Please enter your name");
    return;
  }

  const form = document.getElementById("examForm");
  const formData = new FormData(form);
  const answers = {};

  const fields = form.querySelectorAll("input, textarea");
  const handled = new Set();

  fields.forEach((field) => {
    const questionId = field.name.replace("question_", "");
    if (handled.has(questionId)) return;

    if (field.type === "radio") {
      const checked = form.querySelector(`input[name="question_${questionId}"]:checked`);
      answers[questionId] = checked ? checked.value : "";
    } else {
      answers[questionId] = field.value;
    }

    handled.add(questionId);
  });

  const res = await fetch(`/api/exams/${currentExamId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentName, answers })
  });

  const result = await res.json();

  document.getElementById("resultBox").innerHTML = `
    <div class="result">
      <strong>${result.message}</strong><br />
      MCQ Score: ${result.mcqScore} / ${result.maxScore}<br />
      Current Total: ${result.totalScore} / ${result.maxScore}<br />
      <small>${result.note || ""}</small>
    </div>
  `;
});

loadExams();