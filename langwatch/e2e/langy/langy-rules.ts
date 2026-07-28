/**
 * Reusable LLM-judge criteria for Langy — the "evaluator" side of dogfooding.
 *
 * These are the human-readable pass/fail criteria a `@langwatch/scenario`
 * judgeAgent grades Langy's responses against. They are the executable encoding
 * of Langy's AGENTS.md absolute rules (services/langyagent/internal/assets/AGENTS.md):
 * terse, acts immediately, never asks clarifying questions, never offers next
 * actions, never narrates the command it ran.
 *
 * Kept in one module so every scenario file shares the SAME rubric — and so the
 * same criteria can seed a saved `langevals/llm_boolean` Evaluator against
 * Langy's own traces (see e2e/langy/README.md "Rule-adherence evaluator").
 */

/** The always-on rules every Langy answer must satisfy, regardless of topic. */
export const LANGY_CORE_RULE_CRITERIA = [
  "Langy acts immediately and answers with a result — it does not merely describe a plan it is about to carry out.",
  "Langy does NOT ask the user a clarifying question — it picks a sensible default and proceeds.",
  "Langy does NOT offer 'next actions', options, or 'would you like me to…' follow-ups.",
  "Langy does NOT narrate or echo the CLI command, tool, or flags it ran — the answer is the finding, not the mechanics.",
  "Langy is terse (roughly 1–3 short bullets), with no filler openers like 'Sure!' or 'Assumed:'.",
];

/**
 * Criteria for the greeting / smalltalk flow. A bare "hi" or "who are you?"
 * requests nothing out of scope, so the "Can't do that yet." refusal is the
 * one wrong answer; the right one is a short friendly hello that says what
 * Langy can help with. The core rules about acting immediately do not apply
 * here (there is nothing to act on), so this rubric stands alone.
 */
export const LANGY_GREETING_CRITERIA = [
  "Langy answers the greeting with a short, friendly reply that introduces itself as Langy or the LangWatch assistant.",
  "The greeting reply names at least one concrete thing Langy can help with (for example traces, evaluations, prompts, or scenarios).",
  "Langy does NOT answer the greeting or the \"who are you?\" question with a refusal such as \"Can't do that yet.\"",
  "Langy does not dump internal tool mechanics, CLI commands, or its own rule list in response to a plain greeting.",
];

/**
 * Criteria for the "what has my agent been up to?" overview flow on a project
 * that has traces but no evaluation data. An empty evaluation metric is not an
 * answer; the reply must describe what the traces show and invite the user to
 * pick what to dig into.
 */
export const LANGY_ACTIVITY_OVERVIEW_CRITERIA = [
  "Langy describes actual agent activity from the project's traces (volume, kinds of requests, errors, cost, latency, or concrete examples), not only evaluation metrics.",
  "Langy does NOT stop at an empty evaluation result: a reply that amounts to 'no evaluation data in the last 24h' with nothing else is a failure.",
  "The reply includes at least one concrete observation from the traffic (a number, a pattern, or a named example).",
  "The reply ends by inviting the user to say what to dig into more deeply (a short plain line or a choices card, not a menu of unsolicited offers).",
  "Langy does NOT narrate or echo the CLI commands it ran.",
];

/** Criteria specific to a failed-trace investigation flow. */
export const LANGY_FAILING_TRACES_CRITERIA = [
  "Langy reports on failed/errored traces (a count, the failing traces, or a clear 'no failures' result).",
  "If asked to also do a follow-up step (summarise, group, or explain the failures), Langy completes that step too — it does not stop after the search.",
  ...LANGY_CORE_RULE_CRITERIA,
];

/** Criteria specific to the GitHub "open a PR" flow (the github internal skill). */
export const LANGY_OPEN_PR_CRITERIA = [
  "Langy attempts to open a real pull request (clone/branch/commit/push/PR), or clearly reports the concrete blocker (e.g. the GitHub App is not installed for this org).",
  "Langy does NOT ask the user for a GitHub token or tell them to run `gh auth login` — the installation token is already provisioned.",
  "Langy reports the resulting PR URL when a PR was opened.",
  ...LANGY_CORE_RULE_CRITERIA,
];

/**
 * Criteria for the ambiguous "make me an eval" flow — the ONE flow where a
 * question is required rather than forbidden. AGENTS.md's skills-section
 * exception makes a choice that picks what gets tested the user's, so the
 * no-clarifying-questions core rule is dropped here and replaced with its
 * inverse for the first turn. Everything downstream of the answer is still
 * Langy's to carry alone — including fixing a rejected type slug from the
 * error's own expected list instead of bouncing it back to the user.
 */
export const LANGY_EVAL_CREATION_CRITERIA = [
  "On the first turn, Langy asks ONE short question distinguishing a batch experiment (offline, runs against a dataset) from an online evaluator (scores live production traffic) — and creates NOTHING until the user answers.",
  "Langy does not run any create command (evaluator, monitor, or experiment) before the user has answered the experiment-vs-evaluator question.",
  "After the user answers, Langy creates the matching resource and the creation succeeds — the result names the thing that was created.",
  "If a create is rejected over an invalid field value and the error names the accepted values, Langy corrects that exact field from the error's expected list and retries once within the same turn — it never asks the user to pick a type slug and never abandons the create over a fixable field.",
  ...LANGY_CORE_RULE_CRITERIA.filter(
    (criterion) => !criterion.includes("clarifying question"),
  ),
];
