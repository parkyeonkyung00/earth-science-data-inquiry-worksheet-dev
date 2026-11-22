import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMON_CHECKS, PREFIX, SCAFFOLD_GUIDANCE, SCAFFOLDS, SECTIONS, SUBJECT_EXAMPLES, questionChoices } from "../js/constants.js";
import { parseCode, verificationStatus } from "../js/student.js";
import { CONFIG } from "../js/config.js";

const readJson = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const [original, extra, standards] = await Promise.all(["activities", "activities-extra", "standards"].map(readJson));
const activities = [...original, ...extra];
const [studentSource, stylesheet] = await Promise.all([
  readFile(new URL("../js/student.js", import.meta.url), "utf8"),
  readFile(new URL("../css/style.css", import.meta.url), "utf8"),
]);
const teacherSource = await readFile(new URL("../js/teacher.js", import.meta.url), "utf8");

test("기존 21개와 추가 42개 활동이 전체 62개 성취기준을 포함한다", () => {
  assert.equal(original.length, 21);
  assert.equal(extra.length, 42);
  assert.equal(Object.keys(standards).length, 62);
  assert.equal(new Set(activities.map(a => a.id)).size, 63);
  assert.deepEqual(new Set(activities.map(a => a.code)), new Set(Object.keys(standards)));
  for (const activity of activities) {
    assert.ok(standards[activity.code], activity.id);
    assert.ok(activity.code.startsWith(PREFIX[activity.subj]), activity.id);
    for (const field of ["title", "chart", "predict", "tip", "time", "textbook"]) {
      if (field === "tip" && extra.includes(activity)) continue;
      assert.ok(typeof activity[field] === "string" && activity[field].trim(), `${activity.id}: ${field}`);
    }
    for (const field of ["questions", "vars", "tasks", "checks", "pitfalls"]) {
      assert.ok(activity[field].length >= 2, `${activity.id}: ${field}`);
    }
    assert.ok(activity.data.name && activity.data.org && activity.data.how, activity.id);
    if (activity.data.url) assert.equal(new URL(activity.data.url).protocol, "https:");
  }
});

test("모든 활동의 A 질문은 정확히 4개이며 기존 바로가기 코드가 세 버전에서 유효하다", () => {
  for (const activity of activities) {
    assert.equal(questionChoices(activity).length, 4, activity.id);
    for (const version of ["A", "B", "C"]) {
      const code = `${activity.id.replace("-", "")}-${version}`;
      assert.deepEqual(parseCode(code, activities), { id: activity.id, version });
      assert.deepEqual(parseCode(`#${code.toLowerCase()}`, activities), { id: activity.id, version });
    }
  }
  for (const invalid of ["es9999a", "es0105d", "", "ES0105", "<script>"]) assert.equal(parseCode(invalid, activities), null);
});

test("논문 구조는 8개 단계와 별도 정리 단계, 공통 검증 5개다", () => {
  assert.equal(SCAFFOLDS.length, 8);
  assert.equal(SECTIONS.length, 9);
  assert.equal(SECTIONS[3].n, "§2.5");
  assert.equal(SECTIONS[8].key, "sum");
  assert.equal(COMMON_CHECKS.length, 5);
  assert.ok(COMMON_CHECKS.slice(0, 2).every(item => item.e));
  for (const row of SCAFFOLDS) for (const v of ["A", "B", "C"]) assert.ok(row[v]);
});

test("예측은 단일 선택으로 보존하고 성찰 단계는 검증 미완료 상태에서도 열 수 있다", () => {
  assert.match(studentSource, /setAnswer\(key, value\)/);
  assert.match(studentSource, /state\.step === SECTION_INDEX\.s4/);
  assert.match(studentSource, /button\.addEventListener\("click", \(\) => go\(Number\(button\.dataset\.step\)\)\)/);
  assert.match(studentSource, /id="reflectionShortcut"/);
  assert.match(studentSource, /getElementById\("reflectionShortcut"\)\.addEventListener\("click", \(\) => go\(SECTION_INDEX\.s6\)\)/);
  assert.doesNotMatch(studentSource, /canProceedToReflection/);
  assert.match(studentSource, /검증 기록이 아직 완료되지 않았습니다/);
  assert.match(studentSource, /status === "pass" \|\| revisionRunCount\(\) >= MAX_REVISION_RUNS/);
});

test("예시·사전 지식 안내와 확장 역할 선언 및 보라색 테마가 제공된다", () => {
  for (const content of ["예시 페이지", "배경 지식", "사전 지식 페이지", "role_record", "role_privacy", "decl5"]) {
    assert.ok(studentSource.includes(content), content);
  }
  assert.match(studentSource, /단계별 프롬프트 작성 예시/);
  assert.match(studentSource, /첨부 파일/);
  assert.match(stylesheet, /--accent: #7043A7/);
  assert.match(stylesheet, /\.role-declaration/);
  assert.match(stylesheet, /\.guide/);
});

test("교과별 대표 예시와 비계별 진입·전환 기준을 제공한다", () => {
  assert.equal(SUBJECT_EXAMPLES.length, 3);
  for (const example of SUBJECT_EXAMPLES) assert.ok(activities.some(activity => activity.id === example.activityId));
  assert.equal(SCAFFOLD_GUIDANCE.length, 3);
  assert.match(teacherSource, /SCAFFOLD_GUIDANCE\.map/);
  for (const item of SCAFFOLD_GUIDANCE) {
    assert.ok(item.entry.length > 20);
    assert.ok(item.transition.length > 20);
  }
});

test("출처와 기간 검증을 먼저 제시하고 반복 재실행을 두 회로 제한한다", () => {
  assert.match(studentSource, /출처와 기간/);
  assert.match(studentSource, /MAX_REVISION_RUNS = 2/);
  assert.match(studentSource, /수정 회차는 최대/);
  assert.match(studentSource, /cappedWithIssues/);
  assert.match(studentSource, /status === "pass" \|\| revisionRunCount\(\) >= MAX_REVISION_RUNS/);
});

test("시각적 강조 스타일과 구체적인 공통 오류 사례가 있다", () => {
  assert.ok(COMMON_CHECKS.every(item => item.t && item.h && item.e));
  assert.match(stylesheet, /--accent: #7043A7/);
  assert.match(stylesheet, /\.role-declaration/);
  assert.match(stylesheet, /\.source-first/);
  assert.match(stylesheet, /\.ver-example/);
});

test("빙하 코어와 기별 지층·화석은 정확한 성취기준에 각각 연결한다", () => {
  assert.equal(activities.find(a => a.id === "es-0202").code, "12지구01-06");
  assert.equal(activities.find(a => a.id === "es-0206").code, "12지구02-02");
  assert.ok(standards["12지구02-02"].includes("화석"));
});

const checks = [{ id: "c0" }, { id: "a0" }];
const complete = { ai_result: "관측값으로 그래프 확인", prediction_match: "match",
  trend: "증가", p_shape: "오른쪽 위로 증가", why: "배운 개념에 따른 근거",
  chk_c0: "ok", chkn_c0: "원자료 첫 행 비교", chk_a0: "ok", chkn_a0: "계산식 대조" };

test("검증 기록·예측 비교·모든 판정과 근거가 없으면 통과할 수 없다", () => {
  for (const version of ["A", "B"]) {
    assert.equal(verificationStatus(version, complete, checks), "pass");
    for (const key of Object.keys(complete)) {
      if (version === "B" && key === "why") continue;
      const missing = { ...complete };
      delete missing[key];
      assert.equal(verificationStatus(version, missing, checks), "incomplete", `${version}: ${key}`);
    }
    assert.equal(verificationStatus("invalid", complete, checks), "incomplete");
    assert.equal(verificationStatus(version, { ...complete, chk_c0: "invalid" }, checks), "incomplete");
    assert.equal(verificationStatus(version, { ...complete, prediction_match: "invalid" }, checks), "incomplete");
    assert.equal(verificationStatus(version, { ...complete, chkn_c0: "   " }, checks), "incomplete");
  }
});

test("확인된 오류나 판단 보류는 수정하고 예측 불일치만으로 오류라 하지 않는다", () => {
  for (const version of ["A", "B"]) {
    for (const judgment of ["bad", "unk"]) assert.equal(verificationStatus(version, { ...complete, chk_c0: judgment }, checks), "revise");
    assert.equal(verificationStatus(version, { ...complete, prediction_match: "differ" }, checks), "pass");
  }
});

test("C는 스스로 만든 세 기준과 각 판정·근거가 필요하다", () => {
  const ownChecks = [0, 1, 2].map(i => ({ id: `cc${i}` }));
  const answers = { ai_result: "결과", prediction_match: "match", prediction_free: "값이 증가할 것으로 예상한다" };
  assert.equal(verificationStatus("C", answers, []), "incomplete");
  for (let i = 0; i < 3; i++) {
    answers[`cc_${i}`] = `나의 기준 ${i}`;
    answers[`chk_cc${i}`] = "ok";
    answers[`chkn_cc${i}`] = "독립 확인 근거";
  }
  assert.equal(verificationStatus("C", answers, ownChecks), "pass");
  assert.equal(verificationStatus("C", { ...answers, cc_1: "" }, ownChecks), "incomplete");
  assert.equal(verificationStatus("C", { ...answers, prediction_free: "" }, ownChecks), "incomplete");
  assert.equal(verificationStatus("C", { ...answers, chk_cc1: "unk" }, ownChecks), "revise");
});

test("교사 설문은 지정된 외부 폼으로 연결한다", () => {
  const url = new URL(CONFIG.surveyUrl);
  assert.equal(url.hostname, "docs.google.com");
  assert.ok(url.pathname.endsWith("/viewform"));
});
