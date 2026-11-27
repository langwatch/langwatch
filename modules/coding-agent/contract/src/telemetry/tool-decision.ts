/** What a tool-permission decision did, read the same way for every agent. */
export type ToolDecisionOutcome = "allowed" | "denied" | "redirected" | "aborted" | "unknown";

const ABORTED_DECISIONS = new Set(["abort", "timed_out", "cancelled"]);
const DENIED_DECISIONS = new Set(["reject", "deny"]);
const REDIRECTED_DECISIONS = new Set(["followup"]);
const ALLOWED_DECISIONS = new Set(["accept", "allow"]);

/**
 * Claude: `accept`/`reject`, a walk-away as `source: user_abort`. Codex: `approved*`,
 * `denied*`, `abort`, `timed_out`. Grok: `allow`, `deny`, `cancelled`, and `followup`
 * when the user answered instead of approving. A walk-away is neither a refusal nor a failure.
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
  if (REDIRECTED_DECISIONS.has(decision)) return "redirected";
  if (DENIED_DECISIONS.has(decision) || decision.startsWith("denied")) return "denied";
  if (ALLOWED_DECISIONS.has(decision) || decision.startsWith("approved")) return "allowed";
  return "unknown";
}

/**
 * Whether the person at the prompt made the decision, read from its `source`. Claude and
 * Grok send `user_*` (`user_reject`, `user_followup`), Codex `User`; `config`, `hook`,
 * `classifier`, `AutomatedReviewer` and a missing source are a policy or unknown.
 */
export function toolDecisionByUser({ source }: { source: string | null }): boolean {
  if (source === null) return false;
  const lower = source.toLowerCase();
  return lower === "user" || lower.startsWith("user_");
}
