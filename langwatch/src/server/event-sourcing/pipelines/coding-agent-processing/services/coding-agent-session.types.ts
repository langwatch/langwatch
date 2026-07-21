/**
 * The shape of a coding-agent session summary (ADR-056).
 *
 * ## Light by construction
 *
 * This is an AGGREGATE, not a copy. It stores counters, small bounded sets, and
 * **ids that point back at the heavy data** — never the heavy data itself. The
 * prompts, the replies, the raw API bodies and the tool output already live in
 * the spans, the log records and the blob store; duplicating them here would
 * double the storage for no gain and immediately risk drifting from the source.
 *
 * So: the session's `traceIds` reach the spans and logs, and `finalRequestId`
 * reaches the exact response body that ended the session. Text is measured
 * (`promptChars`, `responseChars`) but never carried.
 *
 * ## Bounded by construction
 *
 * Nothing here may grow with the length of the session. Every field is a scalar,
 * a bounded set, or a small map keyed by a low-cardinality name (a tool, a model,
 * an error class). That invariant is what makes it safe to summarise a session of
 * unknown size — it is the same one that let us delete MAX_PROCESSED_SPANS.
 */

/** One thing the agent did, in the order it did it. */
export interface SessionStep {
  name: string;
  /** Back-to-back runs of the same tool batch into one step. */
  count: number;
  /** True when any run in the batch failed. */
  failed: boolean;
  /** Used to keep the sequence true even when spans arrive out of order. */
  startedAtMs: number;
}

export interface CodingAgentSessionData {
  // ── Identity, and the ids that reach the heavy data ───────────────────
  /** Which agent produced this. Generic; the adapter names it. */
  agent: string | null;
  /** The agent's own session id — reaches every other trace of the same run. */
  sessionId: string | null;
  /** The agent's version, the terminal it ran in, how it was launched. */
  agentVersion: string | null;
  terminalType: string | null;
  entrypoint: string | null;
  /**
   * The request id of the LAST model call. The pointer to the response body that
   * actually ended the session, without carrying a byte of it.
   */
  finalRequestId: string | null;
  /**
   * The human who ran the session, as the agent reports it. Claude Code stamps
   * `user.id` (and usually `user.email`) on every log event; the other agents
   * send no user identity at all (verified against live telemetry), so for
   * them this stays null rather than guessing.
   */
  userId: string | null;

  // ── Shape ─────────────────────────────────────────────────────────────
  modelCalls: number;
  toolCalls: number;
  /**
   * How many distinct sub-agents ran — counted from the `agent_id` the agent
   * stamps on every sub-agent span, NOT from a spawn event.
   *
   * Measured against real data: `claude_code.subagent.spawn` is essentially
   * never emitted, so counting spawns reported ZERO sub-agents for a session
   * that had clearly run four of them (44, 20, 20 and 14 tool spans, each under
   * its own agent_id). Their work then vanished from the step sequence with
   * nothing to explain where it went. The ids are what actually arrive, so the
   * ids are what we count.
   */
  subAgents: number;
  /**
   * Bookkeeping only, not projected to the row: the dedup set behind
   * `subAgents`. The ids are ephemeral per-session UUIDs, so the row carries
   * the COUNT (`SubAgents`) and the TYPES (`SubAgentTypes`), never the ids.
   */
  subAgentIds: string[];
  /** In the order they happened, batched, failures marked in place. */
  steps: SessionStep[];
  /** How many prompts the human sent, and how much they typed. Not the text. */
  prompts: number;
  promptChars: number;
  responseChars: number;

  // ── Work ──────────────────────────────────────────────────────────────
  toolCounts: Record<string, number>;
  toolDurationMs: Record<string, number>;
  filesTouched: string[];
  skills: string[];
  subAgentTypes: string[];
  slashCommands: string[];
  models: string[];
  mcpServers: string[];
  mcpTools: string[];

  // ── Economics ─────────────────────────────────────────────────────────
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /**
   * Tokens spent RE-CREATING the cache. For a coding agent this is the
   * expensive mistake: a cache read is billed at a fraction of fresh input,
   * while a cache write costs MORE than it. A session that keeps re-creating its
   * cache is burning money in a way raw token counts do not show.
   */
  cacheCreationTokens: number;
  costUsd: number;

  // ── Time ──────────────────────────────────────────────────────────────
  /** Wall-clock inside model calls, and inside tools. */
  modelCallMs: number;
  toolMs: number;
  /** Time-to-first-token, kept as a sum + count so the mean survives a fold. */
  ttftMsTotal: number;
  ttftSamples: number;
  /**
   * How long a HUMAN sat waiting to approve a tool. The agent was idle and so
   * was the person — it is the one duration in the session that is pure
   * friction, and nothing else in the telemetry surfaces it.
   */
  blockedOnUserMs: number;
  /** Active time, split by whether the human or the CLI was working. */
  activeTimeUserSec: number;
  activeTimeCliSec: number;

  // ── Context pressure ──────────────────────────────────────────────────
  /** Bytes of tool OUTPUT fed back into the context — the usual cause of bloat. */
  toolResultBytes: number;
  toolInputBytes: number;
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;
  /**
   * The biggest single model call's context (`cacheReadTokens +
   * cacheCreationTokens` for that ONE call) — "how big did the context
   * window get", as distinct from `cacheReadTokens`/`cacheCreationTokens`
   * above, which are cumulative sums across every call and answer a cost
   * question, not a context-size one.
   */
  peakContextTokens: number;
  /**
   * How many model calls re-created most of the context instead of reading
   * it from cache — a cache write costs MORE per token than a read, so this
   * is the session paying twice for the same tokens. Same threshold
   * `sessionView/tokenTimeline.ts`'s `findCacheRebuilds` uses client-side,
   * computed here at fold time so it survives across a session's traces.
   */
  cacheRebuildCount: number;
  /** The single biggest rebuild's `cacheCreationTokens` — the worst offender. */
  largestCacheRebuildTokens: number;
  /**
   * Bookkeeping only, not projected to the row: the previous model call's
   * context size, needed to tell whether the NEXT call rebuilt it. Read by
   * arrival order like the rest of this fold's per-call state — spans can
   * arrive slightly out of order, so this is an approximation, not a ledger.
   */
  previousCallContextTokens: number;

  // ── What went wrong ───────────────────────────────────────────────────
  failedTools: number;
  /** Failure classes, e.g. `{"Error:ENOENT": 3, "ShellError": 1}`. */
  errorTypes: Record<string, number>;
  apiErrors: number;
  /** Rate limits (429) — worth telling apart from every other failure. */
  rateLimited: number;
  retriesExhausted: number;
  /** Total wall-clock burned on retries. Time paid for nothing. */
  retryMs: number;
  /** Total attempts across model calls; > modelCalls means retries happened. */
  attempts: number;
  refusals: number;
  refusalCategories: string[];
  internalErrors: number;

  // ── What the human did, and what the guardrails did ────────────────────
  /** Tools the user DENIED. They never ran, so they have no span at all. */
  toolsDenied: number;
  /** Tools the user aborted mid-run. Not the same as a tool that broke. */
  toolsAborted: number;
  /** The approval mode the session ended in (plan, bypassPermissions, …). */
  permissionMode: string | null;
  /** Times the approval mode was widened — an escalation worth auditing. */
  permissionChanges: number;
  /** Hooks that BLOCKED an action. The safeguards that actually fired. */
  hooksBlocked: number;
  hooksCancelled: number;
  hookMs: number;

  // ── What came out of it ───────────────────────────────────────────────
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  /** Edits the human accepted vs rejected, and in which languages. */
  editsAccepted: number;
  editsRejected: number;
  languagesEdited: string[];
  atMentions: number;

  // ── How it ended ──────────────────────────────────────────────────────
  /** The FINAL model call's stop reason — the earlier ones all say tool_use. */
  stopReason: string | null;
  /** The reply was CUT OFF rather than finished. It is not an answer. */
  truncated: boolean;
}
