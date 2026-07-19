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
