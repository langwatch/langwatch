/**
 * The router's difficulty gate: the frozen question a hosted classifier backend is asked about a
 * case before any judge answers it, the text it reads, and the score read back. The wording and
 * the cut are frozen under the question's name (ADR-190 decision 11): never edit them in place.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  INSTANT_EVAL_JUDGE_GATE_QUESTIONS,
  type InstantEvalJudgeGateQuestionName,
  type InstantEvalJudgeJob,
  type InstantEvalJudgeRouteGate,
  type InstantEvalScoreQuestion,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";

/** What the judge is deciding, as the gate is told it. */
const JOB_LINES: Record<InstantEvalJudgeJob, string> = {
  llm_judge: "LLM-as-a-judge evaluator: does the output pass this evaluator's check?",
  search: "Search question: answer yes or no about the trace or conversation.",
  scenario_judge:
    "Scenario judge: was this success criterion met by the AI agent in the conversation?",
};

/** The task's first characters the gate reads. */
const TASK_CHARS = 3_000;

/** A longer text is shown as its two ends, half of this each. */
const VIEW_CHARS = 12_000;

const GATE_QUESTIONS: Record<
  InstantEvalJudgeGateQuestionName,
  Readonly<{ instructions: string; levels: readonly string[] }>
> = {
  difficulty_v1: {
    instructions: "How hard is it for a judge model to get the verdict on this case right?",
    levels: [
      "trivial: the answer is plainly stated or obviously present or absent",
      "easy: one quick read decides it",
      "moderate: needs care: a detail, an exception or some evidence to find",
      "hard: needs multi-step checking: numbers, dates, rules or tiers, several facts",
      "very hard: subtle errors, buried evidence in a long text, or a long chain of steps",
    ],
  },
};

/**
 * The gate's one score question; its score is a level index, 0 the easiest. Its range is the
 * contract's level count, the same one that bounds a route's threshold.
 */
export function instantEvalJudgeGateQuestionOf({
  name,
  id,
}: {
  name: InstantEvalJudgeGateQuestionName;
  id: string;
}): InstantEvalScoreQuestion {
  const { instructions, levels } = GATE_QUESTIONS[name];
  const { levelCount } = INSTANT_EVAL_JUDGE_GATE_QUESTIONS[name];
  return { id, kind: "score", instructions, range: { min: 0, max: levelCount - 1 }, levels };
}

/**
 * The text the gate reads: the case as a judge would get it, framed so the question is about
 * who should decide it, not about the verdict. A long text is cut in the middle, both ends kept.
 */
export function instantEvalJudgeGateInputOf({
  job,
  task,
  text,
}: {
  job: InstantEvalJudgeJob;
  /** The question the judge is asked: an evaluator's prompt, a search question, a criterion. */
  task: string;
  text: string;
}): string {
  return `An evaluation case that a judge model must decide. You are NOT asked for the verdict; the questions are about which judge should decide it.

Job: ${JOB_LINES[job]}
Task: ${task.slice(0, TASK_CHARS)}
Text length: ${text.length} characters (the view below may be cut in the middle)

<text>
${viewOf(text)}
</text>`;
}

function viewOf(text: string): string {
  if (text.length <= VIEW_CHARS) return text;
  const half = VIEW_CHARS / 2;
  const cut = text.length - VIEW_CHARS;
  return `${text.slice(0, half)}\n\n[... ${cut} characters cut ...]\n\n${text.slice(-half)}`;
}

/** Which way the gate sends a question, and whether it had a score to go by. */
type InstantEvalJudgeGateBranch = Readonly<{ branch: "easy" | "hard"; hasScore: boolean }>;

/**
 * Easy only on a score under the threshold. No readable score (the gate failed, timed out, or
 * answered nothing or a level outside its question's) is hard: an unrated case goes to the
 * stronger judge.
 */
export function instantEvalJudgeGateBranchOf({
  verdict,
  gate,
}: {
  verdict: Pick<InstantEvalVerdict, "score"> | undefined;
  gate: Pick<InstantEvalJudgeRouteGate, "question" | "easyBelow">;
}): InstantEvalJudgeGateBranch {
  const score = verdict?.score;
  const topLevel = INSTANT_EVAL_JUDGE_GATE_QUESTIONS[gate.question].levelCount - 1;
  if (score === undefined || !Number.isFinite(score) || score < 0 || score > topLevel) {
    return { branch: "hard", hasScore: false };
  }
  return { branch: score < gate.easyBelow ? "easy" : "hard", hasScore: true };
}
