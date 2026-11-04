/** What a tool-permission decision did, read the same way for every agent. */
export type ToolDecisionOutcome = "allowed" | "denied" | "aborted" | "unknown";

const ABORTED_DECISIONS = new Set(["abort", "timed_out", "cancelled"]);
const DENIED_DECISIONS = new Set(["reject", "deny", "followup"]);
const ALLOWED_DECISIONS = new Set(["accept", "allow"]);

/**
 * Claude: `accept`/`reject`, a walk-away as `source: user_abort`. Codex: `approved*`,
 * `denied*`, `abort`, `timed_out`. Grok: `allow`, `deny`, `followup` (the user
 * answered instead), `cancelled`. A walk-away is neither a refusal nor a failure.
 */
export function toolDecisionOutcome({
  decision,
  source,
}: {
  decision: string | null;
  source: string | null;
}): ToolDecisionOutcome {
  if (source === "user_abort") return "aborted";
  if (decision === null) return "unknown";
  if (ABORTED_DECISIONS.has(decision)) return "aborted";
  if (DENIED_DECISIONS.has(decision) || decision.startsWith("denied")) return "denied";
  if (ALLOWED_DECISIONS.has(decision) || decision.startsWith("approved")) return "allowed";
  return "unknown";
}
