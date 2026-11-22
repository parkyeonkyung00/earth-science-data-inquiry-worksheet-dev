import {
  COMMON_CHECKS,
  CONSTRAINTS,
  P_CARDS,
  Q_TYPES,
  SECTIONS,
  SUBJECT_EXAMPLES,
  STARTERS,
  SUBJ,
  SUBJ_ORDER,
  TRENDS,
  VERSIONS,
  questionChoices,
} from "./constants.js";

const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

const MAX_REVISION_RUNS = 2;

export function parseCode(input, activities) {
  const normalized = String(input || "").trim().toLowerCase().replace(/^#/, "").replace(/[\s_]/g, "");
  const match = normalized.match(/^(is1|is2|ess|es)-?(\d{4})-?([abc])$/);
  if (!match) return null;
  const id = `${match[1]}-${match[2]}`;
  return activities.some(activity => activity.id === id)
    ? { id, version: match[3].toUpperCase() }
    : null;
}

function hasPrediction(version, answers) {
  const has = key => String(answers[key] || "").trim();
  return version === "C" ? Boolean(has("prediction_free"))
    : Boolean(has("trend") && has("p_shape") && (version !== "A" || has("why")));
}

export function verificationStatus(version, answers, checks) {
  const has = key => String(answers[key] || "").trim();
  if (!["A", "B", "C"].includes(version)) return "incomplete";
  if (!hasPrediction(version, answers)) return "incomplete";
  if (!has("ai_result") || !["match", "differ"].includes(answers.prediction_match)) return "incomplete";
  if (version === "C" && [0, 1, 2].some(i => !has(`cc_${i}`))) return "incomplete";
  if (!checks.length || checks.some(item => !["ok", "bad", "unk"].includes(answers[`chk_${item.id}`])
    || !has(`chkn_${item.id}`))) return "incomplete";
  return checks.some(item => answers[`chk_${item.id}`] !== "ok") ? "revise" : "pass";
}

function classCode(id, version) {
  return `${id.replace("-", "").toUpperCase()}-${version}`;
}

const SECTION_INDEX = Object.fromEntries(SECTIONS.map((section, index) => [section.key, index]));

function answerKey(state) {
  return `evc:${state.act}:${state.version}`;
}

function answer(state, key) {
  return state.ans[key] == null ? "" : state.ans[key];
}

function isChecked(state, key) {
  return Boolean(state.ans[key]);
}

function copyText(text, button) {
  const originalText = button.textContent;
  const copied = () => {
    button.textContent = "복사됨";
    window.setTimeout(() => { button.textContent = originalText; }, 1600);
  };
  const fallback = () => {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.className = "copy-input";
    document.body.appendChild(input);
    input.select();
    let succeeded = false;
    try {
      succeeded = document.execCommand("copy");
    } catch {
      succeeded = false;
    } finally {
      input.remove();
    }
    if (succeeded) copied();
    else button.textContent = "직접 선택해 복사하세요";
  };

  if (!navigator.clipboard?.writeText) {
    fallback();
    return;
  }
  navigator.clipboard.writeText(text).then(copied, fallback);
}

export function renderStudent(app, data, state, actions) {
  let currentAnswerKey = null;
  let saveTimer = null;
  actions.registerFlush?.(flushSave);

  function loadCurrentAnswer() {
    if (!state.act) return;
    const key = answerKey(state);
    if (currentAnswerKey === key) return;
    currentAnswerKey = key;
    state.ans = actions.readStorage(key) || {};
    state.step = Number.isInteger(state.ans._step) ? state.ans._step : 0;
    if (Number.isInteger(state.previewStep)) {
      state.step = state.previewStep;
      state.previewStep = null;
    }
  }

  function revisionRunCount() {
    return Array.isArray(state.ans._verificationHistory) ? state.ans._verificationHistory.length : 0;
  }

  function save() {
    window.clearTimeout(saveTimer);
    const key = state.act ? answerKey(state) : null;
    const answers = state.ans;
    saveTimer = window.setTimeout(() => {
      if (key) actions.writeStorage(key, answers);
      actions.saveLastView();
    }, 250);
  }

  function flushSave() {
    window.clearTimeout(saveTimer);
    if (state.act) actions.writeStorage(answerKey(state), state.ans);
    actions.saveLastView();
  }

  function setAnswer(key, value) {
    if (["ai_result", "prediction_match"].includes(key) && hasPrediction(state.version, state.ans) && !state.ans._predictionAtVerification) {
      state.ans._predictionAtVerification = state.version === "C" ? answer(state, "prediction_free")
        : `${answer(state, "trend")} / ${answer(state, "p_shape")} / ${answer(state, "why")}`;
    }
    if (/^cc_\d$/.test(key) && state.ans[key] !== value) {
      const id = key.replace("cc_", "cc");
      delete state.ans[`chk_${id}`];
      delete state.ans[`chkn_${id}`];
    }
    state.ans[key] = value;
    save();
    refreshRail();
    liveHooks.forEach(hook => hook(key));
  }

  function openActivity(id, version) {
    flushSave();
    state.act = id;
    state.version = version;
    currentAnswerKey = null;
    loadCurrentAnswer();
    save();
  }

  function renderStart() {
    app.innerHTML = `
      <div class="start stack">
        <div class="panel stack">
          <h1>수업 코드를 입력하세요</h1>
          <p class="lead">선생님이 알려 준 코드(예: <span class="mono">ES0105-A</span>)를 입력하면 워크시트가 열립니다. 쓴 내용은 이 브라우저에 자동으로 저장됩니다.</p>
          <form class="join" id="joinForm">
            <input id="joinIn" aria-label="수업 코드" type="text" autocomplete="off" placeholder="ES0105-A" value="">
            <button class="btn primary" type="submit">시작하기</button>
          </form>
          <p class="err" id="joinErr" role="alert" hidden></p>
        </div>
        <div class="panel">
          <h2>또는 활동을 직접 고르기</h2>
          <p class="small muted panel-description">직접 고르면 강한 비계(A) 버전으로 시작합니다.</p>
          ${SUBJ_ORDER.map(subject => `
            <div class="subject-picks">
              <span class="label">${SUBJ[subject]}</span>
              <div class="pick">
                ${data.activities.filter(activity => activity.subj === subject).map(activity => `
                  <button type="button" data-open="${activity.id}">
                    <span class="code">[${escapeHtml(activity.code)}]</span><br>${escapeHtml(activity.title)}
                  </button>
                `).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      ${footer()}`;

    document.getElementById("joinForm").addEventListener("submit", event => {
      event.preventDefault();
      const parsed = parseCode(document.getElementById("joinIn").value, data.activities);
      if (!parsed) {
        const error = document.getElementById("joinErr");
        error.textContent = "코드를 찾을 수 없습니다. 영문 과목 기호, 숫자 네 자리, 버전(A·B·C)을 확인하세요. 예: ES0105-A";
        error.hidden = false;
        return;
      }
      openActivity(parsed.id, parsed.version);
      renderWork();
    });

    app.querySelectorAll("[data-open]").forEach(button => {
      button.addEventListener("click", () => {
        openActivity(button.dataset.open, "A");
        renderWork();
      });
    });
  }

  function renderWork() {
    loadCurrentAnswer();
    state.step = Math.max(0, Math.min(SECTIONS.length - 1, Number(state.step) || 0));
    const activity = data.activities.find(item => item.id === state.act);
    if (!activity) {
      state.act = null;
      renderStart();
      return;
    }

    const rail = `
      <aside class="rail">
        <ol>
          ${SECTIONS.map((section, index) => `
            <li>
              <button type="button" data-step="${index}" ${index === state.step ? 'aria-current="step"' : ""}>
                <span class="n">${section.n}</span>
                <span class="t">${section.t}</span>
                <span class="dot ${isDone(section.key) ? "done" : ""}"></span>
              </button>
            </li>
          `).join("")}
        </ol>
        <div class="meta">
          <span class="vbadge"><b>${state.version}</b>${VERSIONS[state.version].name}</span>
          <span>수업 코드 <span class="mono">${classCode(activity.id, state.version)}</span></span>
          <button class="btn sm ghost" type="button" id="leave">다른 활동 고르기</button>
        </div>
      </aside>`;
    const header = `
      <div class="sheet-head stack">
        <span class="code">[${escapeHtml(activity.code)}] · ${SUBJ[activity.subj]}</span>
        <span class="vbadge"><b>${state.version}</b>${VERSIONS[state.version].name} · 비계 버전</span>
        <h1>${escapeHtml(activity.title)}</h1>
        <p class="small muted">${escapeHtml(data.standards[activity.code])}</p>
        ${activity.code === "12지구01-03" ? '<p class="small muted">“위상 영상”은 고시 원문 표기입니다. 탐구에는 관련 성취수준에 따라 위성 영상을 사용합니다.</p>' : ""}
      </div>`;
    const backgroundPage = `
      <details class="guide background-guide">
        <summary>활동 배경 지식 · 핵심 개념과 자료 읽기</summary>
        <div class="guide-content stack">
          <p><b>성취기준</b> · ${escapeHtml(data.standards[activity.code])}</p>
          <p><b>교과·활동 연결</b> · ${escapeHtml(activity.textbook)}</p>
          <p><b>자료</b> · ${escapeHtml(activity.data.name)} — ${escapeHtml(activity.data.org)}</p>
          <p class="small">${escapeHtml(activity.data.how)}</p>
          <div>
            <b>핵심 변수와 단위</b>
            <ul class="plain">${activity.vars.map(variable => `<li>${escapeHtml(variable.n)} · ${escapeHtml(variable.u)}${variable.r ? ` · 일반 범위: ${escapeHtml(variable.r)}` : ""}</li>`).join("")}</ul>
          </div>
          <p><b>먼저 생각할 질문</b> · ${escapeHtml(activity.questions[0])}</p>
          <p><b>자료의 한계·주의점</b> · ${escapeHtml(activity.pitfalls[0])}</p>
        </div>
      </details>`;

    app.innerHTML = `
      <div class="work">
        ${rail}
        <div class="sheet">
          ${header}
          ${backgroundPage}
          <div id="sec"></div>
          <p class="err" id="navError" role="alert" hidden></p>
          <div class="navrow">
            <button class="btn" type="button" id="prev">이전 단계</button>
            <button class="btn primary" type="button" id="next">다음 단계</button>
          </div>
        </div>
      </div>
      ${footer()}`;

    app.querySelectorAll("[data-step]").forEach(button => {
      button.addEventListener("click", () => go(Number(button.dataset.step)));
    });
    document.getElementById("prev").addEventListener("click", () => go(state.step - 1));
    document.getElementById("next").addEventListener("click", () => {
      if (state.step === SECTION_INDEX.s4) {
        const status = verificationStatus(state.version, state.ans, checkList());
        if (status === "incomplete") {
          showNavigationError("§2.5의 예측(A는 근거 포함), AI 결과, 예측과의 비교, 모든 검증 항목의 판정과 근거를 기록하세요. C 버전은 자신의 기준 3개도 필요합니다.");
          return;
        }
        go(status === "pass" || revisionRunCount() >= MAX_REVISION_RUNS ? SECTION_INDEX.s6 : SECTION_INDEX.s5);
      } else if (state.step === SECTION_INDEX.s5) {
        if (revisionRunCount() >= MAX_REVISION_RUNS) go(SECTION_INDEX.s6);
        else rerunRevision();
      } else go(state.step + 1);
    });
    document.getElementById("leave").addEventListener("click", () => {
      flushSave();
      state.act = null;
      currentAnswerKey = null;
      save();
      renderStart();
    });
    document.getElementById("prev").disabled = state.step === 0;
    document.getElementById("next").hidden = state.step === SECTIONS.length - 1;
    if (state.step === SECTION_INDEX.s4) document.getElementById("next").textContent = "검증 결과에 따라 이동";
    if (state.step === SECTION_INDEX.s5) {
      document.getElementById("next").textContent = revisionRunCount() >= MAX_REVISION_RUNS
        ? "성찰로 이동 (재검증 횟수 제한)" : "수정 프롬프트로 §3 재실행";
    }
    renderSection();
  }

  function showNavigationError(message) {
    const error = document.getElementById("navError");
    error.textContent = message;
    error.hidden = false;
  }

  function rerunRevision() {
    if (revisionRunCount() >= MAX_REVISION_RUNS) {
      showNavigationError(`재검증은 최대 ${MAX_REVISION_RUNS}회까지입니다. 남은 문제를 성찰에 기록하세요.`);
      return;
    }
    const index = Math.min(MAX_REVISION_RUNS, Math.max(1, Number(answer(state, "rounds_n")) || 1)) - 1;
    if (!String(answer(state, `r${index}_problem`)).trim() || !String(answer(state, `r${index}_prompt`)).trim()) {
      showNavigationError("마지막 회차의 발견한 문제와 수정 프롬프트를 기록한 뒤 재실행하세요.");
      return;
    }
    const history = state.ans._verificationHistory || [];
    history.push({ prompt: promptText(), prediction: answer(state, "_predictionAtVerification"),
      result: answer(state, "ai_result"), comparison: answer(state, "prediction_match"),
      revisionReason: answer(state, `r${index}_problem`), revisionPrompt: answer(state, `r${index}_prompt`),
      checks: checkList().map(item => ({ criterion: item.t, judgment: answer(state, `chk_${item.id}`), evidence: answer(state, `chkn_${item.id}`) })) });
    state.ans._verificationHistory = history;
    state.ans[state.version === "A" ? "prompt_final" : "prompt_free"] = answer(state, `r${index}_prompt`);
    Object.keys(state.ans).filter(key => /^chk_|^chkn_/.test(key)).forEach(key => { delete state.ans[key]; });
    delete state.ans.ai_result;
    delete state.ans.prediction_match;
    delete state.ans._predictionAtVerification;
    go(SECTION_INDEX.s3);
  }

  function go(index) {
    if (index < 0 || index >= SECTIONS.length) return;
    state.step = index;
    state.ans._step = index;
    save();
    renderWork();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshRail() {
    app.querySelectorAll(".rail [data-step]").forEach((button, index) => {
      const dot = button.querySelector(".dot");
      if (dot) dot.classList.toggle("done", isDone(SECTIONS[index].key));
    });
  }

  function isDone(key) {
    const has = field => String(answer(state, field)).trim() !== "";
    switch (key) {
      case "s0": return has("pre_trust") && (state.version === "A"
        ? ["decl1", "decl2", "decl3", "decl4", "decl5"].every(key => isChecked(state, key))
        : state.version === "B" ? ["role_self", "role_ai", "role_check", "role_record", "role_privacy"].every(has) : has("decl_own"));
      case "s1": return has("question");
      case "s2": return state.version === "C" ? has("context_free") : has("source") && has("period") && has("place");
      case "s25": return hasPrediction(state.version, state.ans);
      case "s3": return has("prompt_final") || has("prompt_free");
      case "s4": return verificationStatus(state.version, state.ans, checkList()) !== "incomplete";
      case "s5": return has("r0_problem") && has("r0_prompt");
      case "s6": return has("post_trust") && (state.version === "C" ? has("reflection_free") : has("conclusion"));
      default: return false;
    }
  }

  function sectionWrap(sectionIndex, lead, body) {
    const section = SECTIONS[sectionIndex];
    return `
      <section class="sec" aria-labelledby="secTitle">
        <div class="stack section-intro">
          <div class="sec-title"><span class="n">${section.n}</span><h2 id="secTitle">${section.t}</h2></div>
          ${lead ? `<p class="lead">${lead}</p>` : ""}
        </div>
        ${body}
      </section>`;
  }

  function textareaField(key, label, hint, placeholder, rows) {
    return `
      <div class="field">
        <label for="f_${key}">${label}</label>
        ${hint ? `<span class="hint">${hint}</span>` : ""}
        <textarea id="f_${key}" data-k="${key}" rows="${rows || 3}" placeholder="${escapeHtml(placeholder || "")}"></textarea>
      </div>`;
  }

  function inputField(key, label, placeholder, hint) {
    return `
      <div class="field">
        <label for="f_${key}">${label}</label>
        ${hint ? `<span class="hint">${hint}</span>` : ""}
        <input type="text" id="f_${key}" data-k="${key}" placeholder="${escapeHtml(placeholder || "")}">
      </div>`;
  }

  function scaleField(key, label, low, high) {
    return `
      <div class="field">
        <span class="flabel">${label}</span>
        <div class="scale" role="group" aria-label="${escapeHtml(label)}">
          ${[1, 2, 3, 4, 5].map(value => `<button type="button" data-pick="${key}|${value}">${value}</button>`).join("")}
        </div>
        <div class="scale-legend"><span>1 ${low}</span><span>5 ${high}</span></div>
      </div>`;
  }

  function bindFields(root) {
    root.querySelectorAll("[data-k]").forEach(element => {
      const key = element.dataset.k;
      if (element.type === "checkbox") {
        element.checked = Boolean(state.ans[key]);
        element.addEventListener("change", () => setAnswer(key, element.checked));
      } else {
        element.value = answer(state, key);
        element.addEventListener("input", () => setAnswer(key, element.value));
      }
    });
    root.querySelectorAll("[data-pick]").forEach(button => {
      const [key, value] = button.dataset.pick.split("|");
      button.setAttribute("aria-pressed", String(answer(state, key)) === value);
      button.addEventListener("click", () => {
        root.querySelectorAll(`[data-pick^="${key}|"]`).forEach(option => {
          option.setAttribute("aria-pressed", value === option.dataset.pick.split("|")[1]);
        });
        setAnswer(key, value);
      });
    });
  }

  let liveHooks = [];

  function checkList() {
    const activity = data.activities.find(item => item.id === state.act);
    const checks = COMMON_CHECKS
      .slice(0, state.version === "C" ? 2 : COMMON_CHECKS.length)
      .map((item, index) => ({
        id: `c${index}`, t: item.t, h: item.h, e: item.e, kind: "공통",
      }));
    activity.checks.forEach((item, index) => {
      if (state.version === "A" || (state.version === "B" && index < 2)) {
        checks.push({ id: `a${index}`, t: item.t, h: item.h, kind: "이 활동" });
      }
    });
    if (state.version === "C") {
      [0, 1, 2].forEach(index => {
        const text = String(answer(state, `cc_${index}`)).trim();
        if (text) checks.push({ id: `cc${index}`, t: text, h: "", kind: "나의 기준" });
      });
    }
    return checks;
  }

  function verificationRow(item) {
    const selected = answer(state, `chk_${item.id}`);
    return `
      <div class="vrow ${selected}" data-row="${item.id}">
        <div class="vrow-top">
          <p><span class="label">${item.kind}</span><br>${escapeHtml(item.t)}</p>
          <div class="tri" role="group" aria-label="판정">
            ${[["ok", "맞음"], ["bad", "문제 있음"], ["unk", "모르겠음"]].map(([value, label]) => `
              <button type="button" data-v="${value}" data-chk="${item.id}" aria-pressed="${selected === value}">${label}</button>
            `).join("")}
          </div>
        </div>
        ${item.h ? `<p class="vhint"><b>${item.kind === "공통" ? "쉽게 확인하기" : "이 활동에서 확인할 점"}</b> · ${escapeHtml(state.version === "A" || item.kind === "공통" ? item.h : item.h.split(/[。.!?]/)[0])}</p>`
          : `<p class="vhint"><b>쉽게 확인하기</b> · 원자료의 열 이름·단위·조건을 대조하고, 아래 활동별 오류 사례에서 해당하는 점이 있는지 살펴보세요.</p>`}
        ${item.e ? `<p class="ver-example"><b>오류 예시</b> · ${escapeHtml(item.e)}</p>` : ""}
        <input type="text" data-k="chkn_${item.id}" placeholder="근거나 메모" aria-label="메모">
      </div>`;
  }

  function assemblePrompt() {
    const activity = data.activities.find(item => item.id === state.act);
    const variables = activity.vars
      .filter((variable, index) => answer(state, `var_${index}`))
      .map(variable => `- ${variable.n} (단위: ${variable.u})`);
    const tasks = activity.tasks.filter((task, index) => answer(state, `task_${index}`));
    if (answer(state, "task_own")) tasks.push(answer(state, "task_own"));
    const constraints = CONSTRAINTS.filter(item => answer(state, `con_${item.k}`)).map(item => item.t);
    const lines = [
      "너는 고등학생의 지구과학 데이터 탐구를 돕는 파이썬 데이터 분석 조수야. 결론은 내가 내릴 거니까, 너는 분석과 그래프를 정확하게 만들어 줘.",
      "",
      "[탐구 질문]",
      answer(state, "question") || "(§1에서 탐구 질문을 쓰세요)",
      "",
      `[교육과정 성취기준: ${activity.code}]`,
      data.standards[activity.code],
      "이 기준과 연결해 분석하되, 자료로 확인하지 못한 개념이나 인과관계는 단정하지 마.",
      "",
      "[데이터]",
      `- 출처: ${answer(state, "source") || `${activity.data.org} ${activity.data.name}`}`,
      `- 기간: ${answer(state, "period") || "(§2에서 기간을 쓰세요)"}`,
      `- 지역·대상: ${answer(state, "place") || "(§2에서 지역을 쓰세요)"}`,
    ];
    if (variables.length) {
      lines.push("- 사용할 변수:");
      variables.forEach(variable => lines.push(`  ${variable}`));
    }
    if (answer(state, "data_note")) lines.push(`- 참고: ${answer(state, "data_note")}`);
    lines.push("- 첨부한 파일을 사용해. 파일에 없는 값은 지어내지 마.", "");
    lines.push("[할 일]");
    (tasks.length ? tasks : ["(위에서 작업을 고르세요)"]).forEach((task, index) => lines.push(`${index + 1}. ${task}`));
    lines.push(`그래프: ${answer(state, "chart") || activity.chart}`);
    if (constraints.length) {
      lines.push("", "[조건]");
      constraints.forEach(constraint => lines.push(`- ${constraint}`));
    }
    return lines.join("\n");
  }

  function promptText() {
    return state.version === "A"
      ? (answer(state, "prompt_final") || assemblePrompt())
      : answer(state, "prompt_free");
  }

  function downloadSummary() {
    const date = new Date();
    const dateText = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const filename = `워크시트_${classCode(state.act, state.version)}_${dateText}.txt`;
    const blob = new Blob([`\uFEFF${summaryText()}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function summaryText() {
    const activity = data.activities.find(item => item.id === state.act);
    const lines = [];
    const addLine = (label, value) => {
      if (String(value || "").trim()) lines.push(`${label}: ${value}`);
    };
    lines.push(`[지구과학 데이터 탐구 프롬프트 워크시트] ${activity.title}`);
    lines.push(`성취기준 [${activity.code}] ${data.standards[activity.code]}`);
    lines.push(`수업 코드 ${classCode(activity.id, state.version)} (${VERSIONS[state.version].name})`);
    addLine("이름", answer(state, "name"));
    addLine("AI 도구", answer(state, "tool"));
    const status = verificationStatus(state.version, state.ans, checkList());
    lines.push(`검증 상태: ${status === "pass"
      ? "기준별 확인 완료 (예측 불일치만으로 오류로 판단하지 않음)"
      : status === "revise" ? "오류 확인 또는 판정 보류 — 수정·추가 확인 필요" : "미완료"}`);
    if (revisionRunCount() >= MAX_REVISION_RUNS && status === "revise") {
      lines.push(`재검증 횟수 제한: 최대 ${MAX_REVISION_RUNS}회 실행 후 남은 문제를 성찰에 기록`);
    }
    lines.push("", "§0 역할 선언");
    addLine("역할 선언", [
      isChecked(state, "decl1") && "탐구자 선언",
      isChecked(state, "decl2") && "결과는 가설",
      isChecked(state, "decl3") && "정직한 기록",
      isChecked(state, "decl4") && "근거 검증",
      isChecked(state, "decl5") && "개인정보 보호",
    ].filter(Boolean).join(", "));
    addLine("나만의 약속", answer(state, "decl_own"));
    addLine("사전 AI 신뢰도(1~5)", answer(state, "pre_trust"));
    lines.push("", "§1 탐구 문제");
    addLine("탐구 질문", answer(state, "question"));
    addLine("질문 유형", (Q_TYPES.find(item => item.k === answer(state, "qtype")) || {}).b);
    addLine("고른 이유", answer(state, "q_why"));
    lines.push("", "§2 데이터 맥락");
    addLine("출처", answer(state, "source") || `${activity.data.org} ${activity.data.name}`);
    addLine("기간", answer(state, "period"));
    addLine("지역·대상", answer(state, "place"));
    if (state.version === "A") {
      const variables = activity.vars
        .filter((variable, index) => answer(state, `var_${index}`))
        .map(variable => `${variable.n}(${variable.u})`);
      addLine("변수", variables.join(", "));
    } else if (state.version === "B") {
      activity.vars.forEach((variable, index) => {
        const unit = answer(state, `vu_${index}`);
        const range = answer(state, `vr_${index}`);
        if (unit || range) lines.push(`${variable.n}: 단위 ${unit} / 범위 ${range}`);
      });
    } else {
      addLine("변수", answer(state, "vars_free"));
    }
    addLine("자료 메모", answer(state, "data_note"));
    lines.push("", "§2.5 나의 예측");
    addLine("경향", answer(state, "trend"));
    addLine("범위", (answer(state, "p_min") || answer(state, "p_max"))
      ? `${answer(state, "p_min")} ~ ${answer(state, "p_max")} ${answer(state, "p_unit")}`
      : "");
    addLine("그래프 모양", answer(state, "p_shape"));
    addLine("이유", answer(state, "why"));
    lines.push("", "§3 프롬프트", promptText() || "(없음)");
    if (state.version === "C") addLine("자기 평가(1~5)", answer(state, "p_self"));
    lines.push("", "§4 결과 검증");
    addLine("예측과 결과 비교", answer(state, "prediction_match") === "match" ? "일치" : answer(state, "prediction_match") === "differ" ? "불일치" : "");
    addLine("AI 결과", answer(state, "ai_result"));
    const labels = { ok: "맞음", bad: "문제 있음", unk: "모르겠음" };
    checkList().forEach(item => {
      const checked = answer(state, `chk_${item.id}`);
      const note = answer(state, `chkn_${item.id}`);
      if (checked || note) lines.push(`- [${labels[checked] || "미확인"}] ${item.t}${note ? ` / ${note}` : ""}`);
    });
    lines.push("", "§5 수정·반복");
    const roundCount = Math.min(MAX_REVISION_RUNS, Math.max(1, Number(answer(state, "rounds_n")) || 1));
    for (let index = 0; index < roundCount; index++) {
      const problem = answer(state, `r${index}_problem`);
      const prompt = answer(state, `r${index}_prompt`);
      const change = answer(state, `r${index}_change`);
      if (problem || prompt || change) {
        lines.push(`${index + 1}회차`);
        addLine("  문제", problem);
        addLine("  수정 프롬프트", prompt);
        addLine("  변화", change);
      }
    }
    lines.push("", "§6 성찰");
    addLine("사후 AI 신뢰도(1~5)", answer(state, "post_trust"));
    addLine("결론", answer(state, "conclusion"));
    addLine("AI가 한 일과 내가 판단한 일", answer(state, "who"));
    addLine("찾은 오류", answer(state, "errors"));
    addLine("동의하지 않는 부분", answer(state, "disagree"));
    addLine("다음에 바꿀 점", answer(state, "next"));
    addLine("성취수준 자기 점검", answer(state, "self_level"));
    addLine("역할 선언", state.version === "B"
      ? `나: ${answer(state, "role_self")} / AI: ${answer(state, "role_ai")} / 검증: ${answer(state, "role_check")} / 기록: ${answer(state, "role_record")} / 개인정보: ${answer(state, "role_privacy")}`
      : answer(state, "decl_own"));
    addLine("자유 데이터 맥락", answer(state, "context_free"));
    addLine("자유 예측", answer(state, "prediction_free"));
    addLine("자유 성찰", answer(state, "reflection_free"));
    ["source", "concept", "evidence", "limits"].forEach(key => addLine(`성찰 점검 ${key}`, answer(state, `reflect_${key}`) ? "확인" : ""));
    if (state.ans._verificationHistory?.length) {
      lines.push("", "재실행 전 검증 이력", JSON.stringify(state.ans._verificationHistory, null, 2));
    }
    return lines.join("\n");
  }

  function renderSection() {
    liveHooks = [];
    const container = document.getElementById("sec");
    const sectionKey = SECTIONS[state.step].key;
    const activity = data.activities.find(item => item.id === state.act);
    let html = "";

    if (sectionKey === "s0") {
      html = sectionWrap(0, "AI는 탐구를 돕는 도구이고, 결론을 내리는 사람은 나입니다. 시작하기 전에 역할을 분명히 해 두세요.", `
        <div class="row">
          ${inputField("name", "이름 또는 별칭 (선택)", "교사 검토는 익명 별칭 사용", "설문과 별도인 로컬 기록입니다. 개인정보·민감 정보는 입력하지 마세요.")}
          <div class="field">
            <label for="f_tool">사용할 AI 도구</label>
            <select id="f_tool" data-k="tool">
              <option value="">고르세요</option><option>ChatGPT</option><option>Claude</option><option>Gemini</option><option>Copilot</option><option>기타</option>
            </select>
          </div>
        </div>
        <div class="field role-field">
          <span class="flabel">역할 선언 · ${VERSIONS[state.version].name}</span>
          <div class="role-declaration stack">
            <div class="role-heading">
              <span class="label">나의 탐구 원칙</span>
              <b>탐구와 최종 판단은 나, AI는 보조 도구</b>
              <p>AI의 답은 검증 전까지 가설입니다. 자료·근거를 확인하고, 사용 과정은 정직하게 기록하며, 개인정보는 입력하지 않습니다.</p>
            </div>
          ${state.version === "A" ? `
          <label class="check"><input type="checkbox" data-k="decl1"> 나는 탐구 질문과 결론을 스스로 정하는 탐구자이다.</label>
          <label class="check"><input type="checkbox" data-k="decl2"> AI는 자료 분석을 돕지만, 결론과 선택을 대신하지 않는다.</label>
          <label class="check"><input type="checkbox" data-k="decl3"> 그래프와 계산은 원자료·단위·과학 개념으로 확인한다.</label>
          <label class="check"><input type="checkbox" data-k="decl4"> 자료 출처와 사용한 AI·프롬프트를 정직하게 기록한다.</label>
          <label class="check"><input type="checkbox" data-k="decl5"> 개인정보나 민감한 정보를 AI 도구에 입력하지 않는다.</label>
          ` : state.version === "B" ? `
          <p>빈칸을 채워 나와 AI의 역할, 검증·기록 원칙을 정하세요.</p>
          ${inputField("role_self", "내가 결정할 것", "")}
          ${inputField("role_ai", "AI가 도울 것", "")}
          ${inputField("role_check", "결과를 검증할 방법", "예: 원자료의 값·단위와 교과 개념을 대조")}
          ${inputField("role_record", "출처와 AI 사용을 기록하는 방법", "예: 자료 주소, 도구 이름, 보낸 프롬프트 기록")}
          ${inputField("role_privacy", "입력하지 않을 정보", "예: 이름, 연락처, 민감한 개인정보")}
          ` : `
          <p class="note">선언에 담을 기준: 내가 내릴 결정, AI에 맡길 보조 작업과 한계, 검증 근거, 출처·사용 기록, 개인정보 보호.</p>
          ${textareaField("decl_own", "나의 역할 선언", "다섯 기준을 참고해 나만의 문장으로 선언하세요.", "", 5)}`}
          </div>
        </div>
        ${scaleField("pre_trust", "AI가 만든 그래프나 계산 결과를 그대로 믿어도 된다고 생각하나요?", "전혀 아니다", "매우 그렇다")}
        <p class="small muted">비계 버전 A·B·C는 지원의 양입니다. 교육과정의 성취수준 A~E나 학생의 등급을 뜻하지 않습니다.</p>`);
    } else if (sectionKey === "s1") {
      let body = "";
      if (state.version === "A") {
        body = `
          <div class="field">
            <span class="flabel">빈칸을 채워 탐구 질문을 만드세요</span>
            <div class="fill">
              <input type="text" data-k="q_place" placeholder="지역·대상" aria-label="지역 또는 대상"><span>의</span>
              <input type="text" data-k="q_period" placeholder="기간" aria-label="기간"><span>자료에서</span>
              <input type="text" data-k="q_var" placeholder="변수" aria-label="변수"><span>은(는)</span>
              <input type="text" data-k="q_how" placeholder="어떻게 변할까 / 무엇과 관계있을까" aria-label="알고 싶은 것"><span>?</span>
            </div>
          </div>
          <div class="field"><span class="flabel">예시 질문 (눌러서 가져오기)</span><div class="starters">
            ${questionChoices(activity).map((question, index) => `<button type="button" data-ex="${index}">${escapeHtml(question)}</button>`).join("")}
          </div></div>
          ${textareaField("question", "나의 탐구 질문", "빈칸을 채우면 자동으로 만들어집니다. 자연스럽게 다듬어도 됩니다.", "", 2)}`;
      } else if (state.version === "B") {
        body = `
          <div class="field"><span class="flabel">질문 선택지 (또는 자유롭게 작성)</span><div class="starters">
            ${questionChoices(activity).slice(0, 2).map((question, index) => `<button type="button" data-ex="${index}">${escapeHtml(question)}</button>`).join("")}
          </div></div>
          ${textareaField("question", "나의 탐구 질문", "선택지를 다듬거나 새로운 질문을 직접 쓰세요.", "", 2)}`;
      } else {
        body = `
          ${textareaField("question", "나의 탐구 질문", "", "", 2)}
          <div class="note"><b>좋은 탐구 질문의 기준</b><ul class="plain">
            <li>내가 구할 수 있는 데이터로 답할 수 있다.</li>
            <li>변수, 기간, 지역(대상)이 드러난다.</li>
            <li>답을 찾으면 해당 성취기준의 과학 개념을 설명하는 데 도움이 된다.</li>
          </ul></div>`;
      }
      body += `
        <details class="guide">
          <summary>예시 페이지 · 이 활동의 질문과 분석 방향</summary>
          <div class="guide-content stack">
            <p class="small muted">예시는 그대로 제출하는 답이 아니라, 자료에 맞는 질문을 만드는 출발점입니다.</p>
            <ul class="plain">${activity.questions.map(question => `<li>${escapeHtml(question)}</li>`).join("")}</ul>
            <p><b>살펴볼 분석 방향</b> · ${escapeHtml(activity.tasks[0])}</p>
            <p><b>예측해 볼 내용</b> · ${escapeHtml(activity.predict)}</p>
          </div>
        </details>
        <details class="guide">
          <summary>교과별 대표 탐구 예시 · 통합과학과 지구과학</summary>
          <div class="guide-content stack">
            ${SUBJECT_EXAMPLES.map(example => {
              const sample = data.activities.find(item => item.id === example.activityId);
              return sample ? `<div class="subject-example">
                <b>${escapeHtml(example.subject)}</b>
                <span>${escapeHtml(sample.title)}</span>
                <span class="small muted">${escapeHtml(sample.questions[0])}</span>
              </div>` : "";
            }).join("")}
            <p class="small muted">대표 예시는 질문·자료·분석 방법을 참고하기 위한 것이며, 실제 활동에서는 현재 선택한 활동의 자료와 조건을 사용하세요.</p>
          </div>
        </details>`;
      body += textareaField("q_why", "이 질문을 고른 이유", "어떤 과학 개념과 연결되나요?", "", 2);
      html = sectionWrap(1, "데이터로 답할 수 있는 질문을 정합니다.", body);
    } else if (sectionKey === "s2") {
      const dataset = activity.data;
      let variables;
      if (state.version === "A") {
        variables = `
          <div class="tbl-wrap"><table class="vars">
            <thead><tr><th>사용</th><th>변수</th><th>단위</th><th>일반적 범위</th></tr></thead>
            <tbody>${activity.vars.map((variable, index) => `
              <tr><td><input type="checkbox" data-k="var_${index}" aria-label="${escapeHtml(variable.n)} 사용"></td>
                <td>${escapeHtml(variable.n)}</td><td class="u">${escapeHtml(variable.u)}</td><td class="u">${escapeHtml(variable.r)}</td></tr>
            `).join("")}</tbody>
          </table></div>`;
      } else if (state.version === "B") {
        variables = `
          <div class="tbl-wrap"><table class="vars">
            <thead><tr><th>변수</th><th>단위 (직접 확인)</th><th>예상 범위 (직접 조사)</th></tr></thead>
            <tbody>${activity.vars.map((variable, index) => `
              <tr><td>${escapeHtml(variable.n)}</td>
                <td><input type="text" data-k="vu_${index}" aria-label="${escapeHtml(variable.n)} 단위"></td>
                <td><input type="text" data-k="vr_${index}" aria-label="${escapeHtml(variable.n)} 범위"></td></tr>
            `).join("")}</tbody>
          </table></div>
          <span class="hint">단위와 범위는 원자료의 설명(메타데이터)이나 교과서에서 확인하세요.</span>`;
      } else {
        variables = "";
      }
      html = sectionWrap(2, "AI는 내가 알려 준 만큼만 자료를 이해합니다. 자료의 출처, 범위, 단위를 정확히 적으세요.", `
        <div class="source-first">
          <b>먼저 확인 · 출처와 기간</b>
          <ol class="plain">
            <li>다운로드할 기관과 파일이 <b>${escapeHtml(dataset.org)} · ${escapeHtml(dataset.name)}</b>인지 확인합니다.</li>
            <li>원자료의 첫 날짜·마지막 날짜, 지역 코드와 관측 간격을 확인한 뒤 아래에 기록합니다.</li>
            <li>실험·모형 자료라면 측정 조건과 제공자를 기록하고, 실제 파일의 값과 AI 결과를 대조합니다.</li>
          </ol>
        </div>
        <div class="datacard">
          <span class="label">이 활동의 데이터</span><b>${escapeHtml(dataset.name)}</b>
          <span class="small">${escapeHtml(dataset.org)}${dataset.url ? ` · <a href="${escapeHtml(dataset.url)}" target="_blank" rel="noopener">${escapeHtml(dataset.url)}</a>` : ""}</span>
          ${state.version === "A" ? `<span class="small muted">${escapeHtml(dataset.how)}</span>` : ""}
        </div>
        <details class="guide">
          <summary>사전 지식 페이지 · 자료를 보기 전에 확인하기</summary>
          <div class="guide-content">
            <ul class="plain">
              <li><b>자료의 성격:</b> 관측·실험·문헌·모형 중 무엇이며, 누가 언제 어떤 조건에서 만들었나요?</li>
              <li><b>변수와 단위:</b> 각 열이 무엇을 뜻하고 단위와 관측 간격은 무엇인가요?</li>
              <li><b>그래프 읽기:</b> 가로·세로축과 범위를 확인하고, 값의 변화와 자료의 빈칸을 구분하세요.</li>
              <li><b>과학적 해석:</b> 함께 변하는 두 값만으로 원인과 결과를 단정하지 말고, 배운 개념과 다른 설명도 검토하세요.</li>
              <li><b>자료의 한계:</b> 출처·기간·지역·측정 조건이 결론에 미치는 영향을 기록하고, 모르는 값은 지어내거나 결측값을 임의로 0으로 바꾸지 마세요.</li>
            </ul>
          </div>
        </details>
        ${state.version === "C" ? `
        <div class="note"><b>데이터 맥락 자가 완성 체크리스트</b>
          ${["출처·파일과 접근 경로", "기간과 지역·대상", "변수·단위·관측 간격", "값 범위와 결측·이상값", "측정 조건과 자료의 한계"].map((item, index) => `<label class="check"><input type="checkbox" data-k="context_check_${index}">${item}</label>`).join("")}
        </div>
        ${textareaField("context_free", "데이터 맥락 기술", "위 기준을 스스로 확인하며 자유롭게 작성하세요.", "", 8)}
        ` : `
        <div class="row">
          ${inputField("source", "출처", `${dataset.org} ${dataset.name}`)}
          ${inputField("period", "기간", "예: 2015년 1월 ~ 2024년 12월")}
          ${inputField("place", "지역·관측소·대상", "예: 서울(108), 동해 105선")}
        </div>
        <div class="field"><span class="flabel">변수와 단위</span>${variables}</div>
        ${state.version === "A" ? textareaField("data_note", "자료를 열어 보고 알게 된 점", "결측(빈칸, -999 등), 특이한 값, 열 이름 등을 적으세요.", "예: 2019년 3월 자료가 비어 있다.", 3) : ""}`}`);
    } else if (sectionKey === "s25") {
      html = sectionWrap(3, "AI 결과를 보기 전에 나의 예측을 적어 둡니다. 예측은 AI 결과를 비판적으로 볼 기준점이 됩니다.", `
        ${state.version === "C" ? textareaField("prediction_free", "나의 예측", "결과를 보기 전에 예상과 과학적 근거를 자유롭게 기록하세요.", "", 7) : `
        ${state.version === "A" ? `<div class="note">${escapeHtml(activity.predict)}</div>` : ""}
        <div class="field"><span class="flabel">예상하는 경향</span><div class="starters" role="group" aria-label="예상 경향">
          ${TRENDS.map(trend => `<button type="button" data-pick="trend|${trend}">${trend}</button>`).join("")}
        </div></div>
        <div class="tbl-wrap"><table class="vars"><caption>예측 표 (수치 예상이 가능한 경우 범위도 기록)</caption><tbody><tr>
          <td>${inputField("p_min", "예상 최솟값", "")}</td>
          <td>${inputField("p_max", "예상 최댓값", "")}</td>
          <td>${inputField("p_unit", "단위", "")}</td>
        </tr></tbody></table></div>
        ${textareaField("p_shape", "그래프 모양 설명", "", "", 2)}
        ${state.version === "A" ? textareaField("why", "예측의 과학적 근거", "배운 개념을 근거로 빈칸을 완성하세요.", "___ 개념에 따르면 ___ 때문에 ___할 것으로 예상한다.", 3) : ""}`}`);
    } else if (sectionKey === "s3") {
      let body;
      if (state.version === "A") {
        body = `
          <div class="field">
            <span class="flabel">AI에게 시킬 작업 (여러 개 선택)</span>
            ${activity.tasks.map((task, index) => `<label class="check"><input type="checkbox" data-k="task_${index}"> ${escapeHtml(task)}</label>`).join("")}
            ${inputField("task_own", "직접 추가할 작업", "")}
          </div>
          ${inputField("chart", "원하는 그래프", activity.chart)}
          <div class="field"><span class="flabel">조건과 검증 요청</span>
            ${CONSTRAINTS.map(item => `<label class="check"><input type="checkbox" data-k="con_${item.k}"> ${escapeHtml(item.t)}</label>`).join("")}
          </div>
          <div class="field">
            <span class="flabel">완성된 프롬프트</span>
            <span class="hint">§1, §2에 쓴 내용과 위에서 고른 항목으로 자동 조립됩니다. 복사한 뒤 AI 도구에 데이터 파일과 함께 붙여 넣으세요.</span>
            <div class="prompt-out" id="pOut"></div>
          </div>
          <div class="copyrow">
            <button class="btn primary" type="button" id="pCopy">프롬프트 복사</button>
            <button class="btn" type="button" id="pEdit">이 프롬프트로 직접 고치기</button>
          </div>
          ${textareaField("prompt_final", "AI에 실제로 보낸 프롬프트", "직접 고친 경우 여기에 최종본이 남습니다.", "", 6)}`;
      } else if (state.version === "B") {
        body = `
          <div class="field"><span class="flabel">질문 유형 카드</span><div class="cards">
            ${Q_TYPES.map(item => `<button type="button" class="card" data-pick="qtype|${item.k}"><b>${item.b}</b><span>${item.s}</span></button>`).join("")}
          </div></div>
          <div class="field">
            <span class="flabel">프롬프트 요소 카드</span>
            <span class="hint">좋은 프롬프트에 들어갈 요소입니다. 내 프롬프트에 넣은 요소를 체크하세요.</span>
            <div class="cards">${P_CARDS.map(item => `
              <label class="card card-label"><input type="checkbox" data-k="pc_${item.k}">
                <span><b>${item.b}</b><span>${item.s}</span></span>
              </label>
            `).join("")}</div>
          </div>
          ${textareaField("prompt_free", "나의 프롬프트", "§1의 질문과 §2의 데이터 맥락을 바탕으로 직접 쓰세요.", "", 9)}
          <div class="copyrow"><button class="btn primary" type="button" id="pCopy">프롬프트 복사</button><span class="small muted" id="pMiss"></span></div>`;
      } else {
        body = `
          ${textareaField("prompt_free", "나의 프롬프트", "", "", 10)}
          <div class="note"><b>프롬프트 평가 기준</b><ul class="plain">
            <li>AI가 내 자료가 무엇인지(출처, 기간, 변수, 단위) 알 수 있다.</li>
            <li>무엇을 계산하고 어떤 그래프를 그릴지 구체적이다.</li>
            <li>AI가 결측 처리나 가정을 숨기지 못하도록 설명을 요구한다.</li>
            <li>결과를 내가 검증할 수 있는 형태(요약 표, 값 범위)로 받는다.</li>
          </ul></div>
          ${scaleField("p_self", "내 프롬프트는 위 기준을 얼마나 만족하나요?", "거의 못 함", "모두 만족")}
          <div class="copyrow"><button class="btn primary" type="button" id="pCopy">프롬프트 복사</button></div>`;
      }
      const samplePrompt = [
        "[역할] 자료를 분석하는 조수로서 계산과 그래프를 돕고, 결론은 제가 내리도록 근거를 설명해 주세요.",
        `[자료] ${activity.data.name} (${activity.data.org}); 기간: [내가 확인한 기간]; 지역·대상: [내가 확인한 지역·대상]`,
        `[탐구 질문] ${activity.questions[0]}`,
        `[핵심 작업] ${activity.tasks[0]}`,
        `[출력] ${activity.chart}`,
        `[검증] ${activity.checks[0].t} 원자료에 없는 값은 만들지 말고, 결측·가정·처리 방법을 먼저 밝혀 주세요.`,
        "[첨부 파일] 위 출처에서 받은 실제 자료 파일을 함께 첨부합니다. 파일을 읽지 못하면 분석을 추측하지 말고 알려 주세요.",
      ].join("\n");
      body += `
        <details class="guide prompt-guide">
          <summary>단계별 프롬프트 작성 예시 · 핵심 요소와 선택 요소</summary>
          <div class="guide-content stack">
            <p><b>핵심 요소</b> · 탐구 질문, 자료 출처·기간·지역·변수와 단위, 요청할 작업, 원하는 표·그래프, 원자료와 대조할 검증 기준.</p>
            <p><b>선택 요소</b> · 추가 비교, 보조 축, 코드 주석, 출력 표의 세부 형식. 필요한 것만 더하고 자료에 없는 조건은 만들지 않습니다.</p>
            <ol class="plain">
              <li>§2에서 실제 자료의 출처·기간·지역을 확인합니다.</li>
              <li>현재 활동의 예시에서 대괄호 내용을 내 자료와 탐구 질문으로 바꿉니다.</li>
              <li>필요한 작업과 검증 요청을 선택하고, 선택 요소는 과제에 필요할 때만 추가합니다.</li>
              <li>실제 CSV·표 파일을 AI 도구에 직접 첨부하고, 파일을 읽었는지 먼저 확인합니다.</li>
              <li>AI 결과를 원자료·단위·과학 개념과 대조합니다. 예시는 문장 구조만 참고하고 답이나 수치를 복사하지 않습니다.</li>
            </ol>
            <pre class="prompt-out">${escapeHtml(samplePrompt)}</pre>
          </div>
        </details>`;
      html = sectionWrap(4, "AI에게 보낼 프롬프트를 만듭니다. 데이터 파일(CSV 등)은 AI 도구에 함께 첨부하세요.", body);
    } else if (sectionKey === "s4") {
      const checks = checkList();
      let body = `
        <div class="predict-recap">
          <b>나의 예측</b> · ${escapeHtml(state.version === "C" ? answer(state, "prediction_free") || "(아직 없음)" : answer(state, "trend") || "(아직 없음)")}
          ${answer(state, "p_min") || answer(state, "p_max") ? ` · 범위 ${escapeHtml(answer(state, "p_min"))} ~ ${escapeHtml(answer(state, "p_max"))} ${escapeHtml(answer(state, "p_unit"))}` : ""}
          <br><span class="small muted">${escapeHtml(answer(state, "p_shape"))}</span>
        </div>
        ${textareaField("ai_result", "AI가 만든 결과 기록", "그래프의 모양, 핵심 수치, AI의 설명을 옮겨 적으세요. 그래프 이미지는 따로 저장해 두세요.", "", 4)}
        <div class="field"><span class="flabel">예측–결과 비교</span>
          <div class="cards">
            <button type="button" class="card" data-pick="prediction_match|match">예측과 일치</button>
            <button type="button" class="card" data-pick="prediction_match|differ">예측과 불일치</button>
          </div>
          <p class="hint">일치는 정확성의 증명이 아니며 불일치는 오류의 증거가 아닙니다. 원자료·계산·개념을 확인하고, 불일치하면 §5에서 예측 또는 분석을 재검토하세요.</p>
        </div>`;
      if (state.version === "C") {
        body += `
          <div class="field">
            <span class="flabel">나만의 검증 기준 세우기</span>
            <span class="hint">출처와 기간 확인 뒤, 이 자료에서 잘못된 결과를 알아챌 기준을 세 가지 이상 스스로 정하세요.</span>
            ${[0, 1, 2].map(index => `<input type="text" data-k="cc_${index}" placeholder="검증 기준 ${index + 1}" aria-label="검증 기준 ${index + 1}">`).join("")}
          </div>`;
      }
      body += `<div class="field"><span class="flabel">검증 체크</span>
          <p class="hint">각 항목을 쉬운 확인 기준과 오류 예시에 따라 판정하세요. 예측과 다른 결과만으로 오류라고 판단하지 말고 원자료에서 오류가 확인되었는지 살핍니다.</p>
          <div class="tally" id="tally"></div>
        </div>
        <details class="guide">
          <summary>이 활동에서 실제로 주의할 오류 사례</summary>
          <div class="guide-content"><ul class="plain">${activity.pitfalls.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        </details>
        <div class="stack" id="vlist">${checks.map(verificationRow).join("")}</div>`;
      html = sectionWrap(5, "자료 출처·기간을 먼저 확인한 뒤, 검증 기준에서 실제 오류가 발견될 때만 수정·재실행합니다. 예측과 결과가 다르더라도 그 자체는 오류가 아닙니다.", body);
    } else if (sectionKey === "s5") {
      const roundCount = Math.min(MAX_REVISION_RUNS, Math.max(1, Number(answer(state, "rounds_n")) || 1));
      const problems = checkList().filter(item => ["bad", "unk"].includes(answer(state, `chk_${item.id}`)));
      let body = problems.length
        ? `<div class="note"><b>§4에서 문제 또는 확인 어려움으로 표시한 항목</b><ul class="plain">
            ${problems.map(item => `<li>${answer(state, `chk_${item.id}`) === "unk" ? "확인 필요 · " : ""}${escapeHtml(item.t)}${answer(state, `chkn_${item.id}`) ? ` — <span class="muted">${escapeHtml(answer(state, `chkn_${item.id}`))}</span>` : ""}</li>`).join("")}
          </ul></div>`
        : '<p class="note">§4 검증 기준에서 확인된 오류가 없습니다. 예측과 결과가 달랐다면 어느 쪽이 자료와 더 잘 맞는지 성찰에 기록하세요.</p>';
      for (let index = 0; index < roundCount; index++) {
        body += `
          <div class="round">
            <h3><span class="mono">${index + 1}회차</span> 수정</h3>
            ${textareaField(`r${index}_problem`, state.version === "C" ? "수정·재검토 기록" : "발견한 문제와 근거", state.version === "A" ? "무엇이 왜 문제인지, 원자료·계산·예측 중 어느 것을 재검토했는지 쓰세요." : "", "", state.version === "C" ? 5 : 2)}
            ${state.version === "A" ? `
              <div class="field"><span class="flabel">수정 프롬프트 문장 틀 (눌러서 넣기)</span><div class="starters">
                ${STARTERS.map((starter, starterIndex) => `<button type="button" data-starter="${index}|${starterIndex}">${escapeHtml(starter)}</button>`).join("")}
              </div></div>` : state.version === "B" ? '<p class="note">문제 → 수정 요청 → 재실행 결과를 연결해 기록하세요.</p>' : ""}
            ${textareaField(`r${index}_prompt`, "수정해서 보낸 프롬프트", "", "", 3)}
            ${state.version !== "C" ? textareaField(`r${index}_change`, "재실행 후 결과 변화", state.version === "A" ? "재실행과 재검증 후 돌아와 해결 여부와 새 문제를 기록하세요." : "", "", 2) : ""}
          </div>`;
      }
      body += roundCount < MAX_REVISION_RUNS
        ? '<div><button class="btn" type="button" id="addRound">수정 회차 추가 (최대 2회)</button></div>'
        : `<p class="note">수정 회차는 최대 ${MAX_REVISION_RUNS}회입니다. 재검증 후에도 문제가 남으면 추가 실행을 반복하지 말고 성찰에 남은 문제와 한계를 기록하세요.</p>`;
      if (revisionRunCount() >= MAX_REVISION_RUNS) {
        body += `<div class="note"><b>재검증 횟수 제한</b> · ${MAX_REVISION_RUNS}회 재실행했습니다. 남은 항목은 성찰에서 명시하고 §6으로 이동하세요.</div>`;
      }
      html = sectionWrap(6, "검증 기준에서 확인된 오류를 고쳐 최대 2회 재실행합니다. 예측 자체가 잘못되었다면 이유를 §2.5에 남기되, 예측과 맞추려고 관측값을 바꾸지 마세요. 재실행 전 결과와 판정은 정리에 이력으로 남습니다.", body);
    } else if (sectionKey === "s6") {
      const level = data.levels[activity.code];
      const unresolvedChecks = checkList().filter(item => ["bad", "unk"].includes(answer(state, `chk_${item.id}`)));
      const cappedWithIssues = revisionRunCount() >= MAX_REVISION_RUNS && unresolvedChecks.length;
      const reflectionStatus = verificationStatus(state.version, state.ans, checkList());
      let body = state.version === "C" ? `
        ${scaleField("post_trust", "탐구 후 AI 결과를 그대로 믿어도 된다고 생각하나요?", "전혀 아니다", "매우 그렇다")}
        <p class="small muted" id="trustCmp"></p>
        ${textareaField("reflection_free", "나의 성찰", "탐구 결론과 근거, 나와 AI의 역할, 검증 경험을 되돌아보세요.", "", 9)}
      ` : `
        ${state.version === "A" ? `<div class="field"><span class="flabel">성찰 체크리스트</span>
          ${[["source", "자료와 AI 사용 과정을 정직하게 기록했다."], ["concept", "성취기준의 과학 개념으로 결과를 설명했다."], ["evidence", "검증한 수치를 근거로 결론을 냈다."], ["limits", "불확실성과 탐구의 한계를 구분했다."]].map(([key, text]) => `<label class="check"><input type="checkbox" data-k="reflect_${key}">${text}</label>`).join("")}
        </div>` : ""}
        ${scaleField("post_trust", "탐구를 마친 지금, AI 결과를 그대로 믿어도 된다고 생각하나요?", "전혀 아니다", "매우 그렇다")}
        <p class="small muted" id="trustCmp"></p>
        ${textareaField("conclusion", "탐구 질문에 대한 나의 결론", "§1의 질문에 답하고, 근거가 된 수치를 함께 쓰세요.", "", 4)}
        ${textareaField("who", "AI가 한 일과 내가 판단한 일", "AI는 무엇을 했고, 무엇을 결정한 것은 나였나요?", "", 3)}
        ${textareaField("errors", "AI 결과에서 찾은 오류와 찾아낸 방법", "어떤 단서로 오류를 알아챘나요? 오류가 없었다면 어떻게 확인했나요?", "", 3)}
        ${textareaField("disagree", "AI 설명 중 동의하지 않거나 더 확인이 필요한 부분", "", "", 2)}
        ${textareaField("next", "다음에 AI로 데이터를 탐구할 때 바꿀 점", "", "", 2)}`;
      if (cappedWithIssues) {
        body = `<div class="error reflection-warning" role="note">
        <b>최대 재검증 횟수에 도달했습니다.</b>
        <p>아래 항목은 해결되지 않았거나 확인이 더 필요합니다. 오류를 숨기지 말고 결론의 한계와 추가로 필요한 확인을 성찰에 기록하세요.</p>
        <ul class="plain">${unresolvedChecks.map(item => `<li>${escapeHtml(item.t)}${answer(state, `chkn_${item.id}`) ? ` — ${escapeHtml(answer(state, `chkn_${item.id}`))}` : ""}</li>`).join("")}</ul>
        </div>${body}`;
      } else if (reflectionStatus !== "pass") {
        body = `<div class="note reflection-warning" role="note">
          <b>${reflectionStatus === "incomplete" ? "검증 기록이 아직 완료되지 않았습니다." : "검증에서 확인할 항목이 남아 있습니다."}</b>
          <p>성찰은 작성할 수 있지만, 이 상태는 검증 완료를 뜻하지 않습니다. 남은 점검 사항을 숨기지 말고 성찰에 기록하세요.</p>
        </div>${body}`;
      }
      if (level && state.version !== "C") {
        body += `
          <div class="field">
            <span class="flabel">성취수준 자기 점검</span>
            <span class="hint">이번 탐구로 도달했다고 생각하는 수준을 고르세요.</span>
            <div class="stack level-options">
              ${["A", "B", "C", "D", "E"].map(letter => `
                <button type="button" class="card" data-pick="self_level|${letter}">
                  <b class="mono">${letter}</b><span>${escapeHtml(level[letter])}</span>
                </button>`).join("")}
            </div>
          </div>`;
      }
      html = sectionWrap(SECTION_INDEX.s6, "탐구 과정을 되돌아봅니다. 특히 AI를 얼마나, 어떻게 믿었는지 점검하세요.", body);
    } else if (sectionKey === "sum") {
      html = sectionWrap(8, "모든 단계의 기록을 한 번에 모았습니다. 복사해서 한글, 구글 클래스룸, 학습지 제출란에 붙여 넣으세요.", `
        <div class="copyrow">
          <button class="btn primary" type="button" id="sumCopy">전체 기록 복사</button>
          <button class="btn" type="button" id="sumDownload">텍스트 파일로 저장</button>
          <button class="btn" type="button" id="sumPrint">인쇄하기</button>
          <span class="small muted">미완성 기록도 저장할 수 있습니다. 검증 완료를 뜻하지 않습니다. 이 기록은 연구자에게 자동 전송되지 않습니다.</span>
        </div>
        <div class="summary-out" id="sumOut"></div>
        <details class="details">
          <summary>이 활동의 기록 지우기</summary>
          <p class="small muted">이 브라우저에 저장된 이 활동(버전 ${state.version})의 기록을 모두 지웁니다. 되돌릴 수 없습니다.</p>
          <button class="btn sm" type="button" id="wipe">기록 지우기</button>
        </details>`);
    }

    container.innerHTML = html;
    bindFields(container);
    wireSection(sectionKey);
  }

  function wireSection(sectionKey) {
    const container = document.getElementById("sec");
    if (sectionKey === "s1" && state.version === "A") {
      const buildQuestion = () => {
        const parts = ["q_place", "q_period", "q_var", "q_how"].map(key => answer(state, key));
        if (parts.some(Boolean)) {
          const question = `${parts[0] || "○○"}의 ${parts[1] || "○○"} 자료에서 ${parts[2] || "○○"}은(는) ${parts[3] || "어떻게 변할까"}?`;
          state.ans.question = question;
          document.getElementById("f_question").value = question;
        }
      };
      liveHooks.push(key => {
        if (/^q_(place|period|var|how)$/.test(key)) {
          buildQuestion();
          save();
          refreshRail();
        }
      });
    }
    if (sectionKey === "s1" && state.version !== "C") {
      container.querySelectorAll("[data-ex]").forEach(button => {
        button.addEventListener("click", () => {
          state.ans.question = questionChoices(data.activities.find(item => item.id === state.act))[Number(button.dataset.ex)];
          document.getElementById("f_question").value = state.ans.question;
          setAnswer("question", state.ans.question);
        });
      });
    }

    if (sectionKey === "s25") {
      container.querySelectorAll('[data-pick^="trend|"]').forEach(button => {
        button.setAttribute("aria-pressed", answer(state, "trend") === button.dataset.pick.split("|")[1]);
      });
    }

    if (sectionKey === "s3") {
      const output = document.getElementById("pOut");
      if (output) {
        const update = () => { output.textContent = assemblePrompt(); };
        update();
        liveHooks.push(update);
        document.getElementById("pEdit").addEventListener("click", () => {
          state.ans.prompt_final = assemblePrompt();
          const field = document.getElementById("f_prompt_final");
          field.value = state.ans.prompt_final;
          field.focus();
          setAnswer("prompt_final", state.ans.prompt_final);
        });
      }
      const missing = document.getElementById("pMiss");
      if (missing) {
        const update = () => {
          const names = P_CARDS.filter(item => !answer(state, `pc_${item.k}`)).map(item => item.b);
          missing.textContent = names.length ? `아직 체크하지 않은 요소: ${names.join(", ")}` : "여섯 요소를 모두 넣었습니다.";
        };
        update();
        liveHooks.push(update);
      }
      const copyButton = document.getElementById("pCopy");
      copyButton.addEventListener("click", () => {
        const text = promptText();
        if (!text.trim()) {
          copyButton.textContent = "프롬프트가 비어 있습니다";
          window.setTimeout(() => { copyButton.textContent = "프롬프트 복사"; }, 1600);
          return;
        }
        if (state.version === "A" && !answer(state, "prompt_final")) {
          state.ans.prompt_final = text;
          const field = document.getElementById("f_prompt_final");
          if (field) field.value = text;
          setAnswer("prompt_final", text);
        }
        copyText(text, copyButton);
      });
    }

    if (sectionKey === "s4") {
      const updateTally = () => {
        const counts = { ok: 0, bad: 0, unk: 0 };
        const checks = checkList();
        checks.forEach(item => {
          const value = answer(state, `chk_${item.id}`);
          if (Object.hasOwn(counts, value)) counts[value]++;
        });
        const remaining = checks.length - counts.ok - counts.bad - counts.unk;
        const tally = document.getElementById("tally");
        if (!tally) return;
        tally.innerHTML = `
          <span class="pill ok">맞음 ${counts.ok}</span>
          <span class="pill bad">문제 있음 ${counts.bad}</span>
          <span class="pill unk">모르겠음 ${counts.unk}</span>
          <span class="small muted">남은 항목 ${remaining}</span>`;
      };
      updateTally();

      const bindChecks = () => {
        container.querySelectorAll("[data-chk]").forEach(button => {
          button.addEventListener("click", () => {
            const key = `chk_${button.dataset.chk}`;
            state.ans[key] = answer(state, key) === button.dataset.v ? "" : button.dataset.v;
            const row = container.querySelector(`[data-row="${button.dataset.chk}"]`);
            row.className = `vrow ${answer(state, key)}`;
            row.querySelectorAll("[data-chk]").forEach(option => {
              option.setAttribute("aria-pressed", answer(state, key) === option.dataset.v);
            });
            updateTally();
            setAnswer(key, state.ans[key]);
          });
        });
      };
      bindChecks();
      if (state.version === "C") {
        liveHooks.push(key => {
          if (!/^cc_/.test(key)) return;
          const list = document.getElementById("vlist");
          list.innerHTML = checkList().map(verificationRow).join("");
          bindFields(list);
          bindChecks();
          updateTally();
        });
      }
    }

    if (sectionKey === "s5") {
      document.getElementById("addRound")?.addEventListener("click", () => {
        state.ans.rounds_n = Math.min(MAX_REVISION_RUNS, Math.max(1, Number(answer(state, "rounds_n")) || 1) + 1);
        save();
        renderSection();
      });
      container.querySelectorAll("[data-starter]").forEach(button => {
        button.addEventListener("click", () => {
          const [round, starter] = button.dataset.starter.split("|");
          const key = `r${round}_prompt`;
          state.ans[key] = `${answer(state, key) ? `${answer(state, key)}\n` : ""}${STARTERS[Number(starter)]}`;
          const field = document.getElementById(`f_${key}`);
          field.value = state.ans[key];
          field.focus();
          setAnswer(key, state.ans[key]);
        });
      });
    }

    if (sectionKey === "s6") {
      const updateTrustComparison = () => {
        const before = Number(answer(state, "pre_trust"));
        const after = Number(answer(state, "post_trust"));
        const comparison = document.getElementById("trustCmp");
        if (!comparison) return;
        comparison.textContent = before && after
          ? `§0에서 ${before}점 → 지금 ${after}점${after < before
            ? " (신뢰가 낮아졌습니다. 그 이유를 아래에 써 보세요.)"
            : after > before
              ? " (신뢰가 높아졌습니다. 무엇을 확인했기 때문인가요?)"
              : " (변화 없음)"}`
          : before ? `§0에서는 ${before}점이었습니다.` : "";
      };
      updateTrustComparison();
      liveHooks.push(updateTrustComparison);
    }

    if (sectionKey === "sum") {
      document.getElementById("sumOut").textContent = summaryText();
      document.getElementById("sumCopy").addEventListener("click", event => copyText(summaryText(), event.currentTarget));
      document.getElementById("sumDownload").addEventListener("click", downloadSummary);
      document.getElementById("sumPrint").addEventListener("click", () => window.print());
      document.getElementById("wipe").addEventListener("click", event => {
        const button = event.currentTarget;
        if (button.dataset.armed) {
          window.clearTimeout(saveTimer);
          state.ans = {};
          actions.writeStorage(answerKey(state), {});
          state.step = 0;
          state.ans._step = 0;
          save();
          renderWork();
        } else {
          button.dataset.armed = "1";
          button.textContent = "한 번 더 누르면 지워집니다";
          button.classList.add("primary");
        }
      });
    }
  }

  function footer() {
    return actions.footer();
  }

  if (state.act) {
    loadCurrentAnswer();
    renderWork();
  } else {
    renderStart();
  }
}
