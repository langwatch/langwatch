/**
 * Reusable LLM-judge criteria for Langy — the "evaluator" side of dogfooding.
 *
 * These grade OUTCOMES a user would notice: whether the question got answered,
 * whether the answer is grounded in the project's real data, and whether the
 * reply reads well in the panel. They deliberately do NOT restate Langy's own
 * prompt rules — grading the prompt's rules back at the agent is circular (the
 * suite would measure obedience, not quality, and every prompt change would
 * need a matching criteria change). Layer 2 REST checks in the tests verify
 * side effects; these criteria carry the conversation-quality half.
 *
 * Kept in one module so every scenario file shares the SAME rubric — and so
 * the same criteria can seed a saved `langevals/llm_boolean` Evaluator against
 * Langy's own traces (see e2e/langy/README.md "Rule-adherence evaluator").
 */

/**
 * Decisiveness, split out because one flow (eval creation) legitimately
 * inverts it: there the first turn MUST ask the experiment-vs-evaluator
 * question. Exclude it by identity (`c !== LANGY_DECISIVENESS_CRITERION`),
 * never by matching on its wording.
 */
export const LANGY_DECISIVENESS_CRITERION =
  "Langy resolves details it could decide itself (time ranges, formats, which command fits) instead of asking the user; it asks only when the choice spends the user's money or picks what gets tested.";

/** The always-on outcome rubric every Langy answer is graded against. */
export const LANGY_CORE_RULE_CRITERIA = [
  "Langy answers the user's actual question with concrete results from their project (real counts, names, findings, or a clear empty result) — not with a plan, a capability list, or a description of what it is about to do. When the platform refuses the action over permissions, the refusal stated plainly with a real path forward IS the concrete answer.",
  "Numbers, names, and ids in the reply come from what was actually retrieved; nothing is invented or estimated when the real value was available. Judge this against the conversation itself (the tool results and cards visible in the transcript): an id contradicting that visible evidence fails, but do not demand proof from telemetry, spans, or any source outside the conversation.",
  LANGY_DECISIVENESS_CRITERION,
  "The reply reads as the answer, not as a work log: no filler openers, no raw JSON or stack traces pasted into prose, no play-by-play of the commands it ran. A fenced code block tagged langy-card is the product's own UI (it renders as a real card, not as JSON) and is not a violation by itself. Offering a next step is fine only once the asked question is fully answered: an offer or menu that stands in for the answer, or buries it, is a failure.",
  "Every reply ends with visible text for the user — a turn whose actions succeeded but whose reply is empty is a failure.",
  "The reply's length matches the question: compact for a lookup, complete for an analysis or diagnosis — nothing padded, and nothing the user asked for missing.",
];

/**
 * Criteria for the greeting / smalltalk flow. A bare "hi" or "who are you?"
 * requests nothing out of scope, so a refusal is the one wrong answer; the
 * right one is a short friendly hello that says what Langy can help with. The
 * core rubric's "answers with concrete results" does not apply (there is
 * nothing to retrieve), so this rubric stands alone.
 */
export const LANGY_GREETING_CRITERIA = [
  "Langy answers the greeting with a short, friendly reply that introduces itself as Langy or the LangWatch assistant.",
  "The greeting reply names at least one concrete thing Langy can help with (for example traces, evaluations, prompts, or scenarios).",
  'Langy does NOT answer the greeting or the "who are you?" question with a refusal such as "Can\'t do that yet."',
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
  "The reply reads as the overview itself, not as a log of the commands that produced it.",
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
  "If a PR was opened, the reply carries its URL. If the platform blocked the flow (GitHub App not installed for the project), naming that blocker IS the passing outcome and no URL is expected.",
  ...LANGY_CORE_RULE_CRITERIA,
];

/**
 * Criteria for the ambiguous "make me an eval" flow — the ONE flow where a
 * question is required rather than wrong: which kind of evaluation gets built
 * decides what gets tested, so the choice is the user's. The decisiveness
 * criterion is excluded by identity and replaced with its inverse for the
 * first turn. Everything downstream of the answer is still Langy's to carry
 * alone — including fixing a rejected type slug from the error's own expected
 * list instead of bouncing it back to the user.
 */
export const LANGY_EVAL_CREATION_CRITERIA = [
  "On the first turn, Langy asks ONE short question distinguishing a batch experiment (offline, runs against a dataset) from an online evaluator (scores live production traffic) — and creates NOTHING until the user answers.",
  "Langy does not run any create command (evaluator, monitor, or experiment) before the user has answered the experiment-vs-evaluator question.",
  "After the user answers, Langy runs the matching create. A batch answer ends with a successful creation naming the thing created. A live answer ends with the evaluator created, and the monitor either created or refused by the platform over permissions with Langy stating that refusal and the user's next step in one line — a silent stop or an unexplained drop of the request fails this.",
  "If a create is rejected over an invalid field value and the error names the accepted values, Langy corrects that exact field from the error's expected list and retries once within the same turn — it never asks the user to pick a type slug and never abandons the create over a fixable field.",
  ...LANGY_CORE_RULE_CRITERIA.filter(
    (criterion) => criterion !== LANGY_DECISIVENESS_CRITERION,
  ),
];
