import { parseMcpToolName } from "@langwatch/coding-agent-contract";
import { z } from "zod";

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

/**
 * Who set the session's `title`, in rank order: the harness's own session
 * name beats the generated conversation title beats the prompt-derived name.
 *
 * A schema rather than a bare union because the value is also decoded back
 * from a row column, so the names have to exist at runtime. One declaration
 * serves both, and the two cannot drift apart.
 */
export const sessionTitleSourceSchema = z.enum(["prompt", "generated", "name"]);
export type SessionTitleSource = z.infer<typeof sessionTitleSourceSchema>;

/**
 * One converged metric unit, as its contribution delivered it. A cumulative
 * series is one unit (its latest total wins); a delta point is its own unit
 * (each sums once). Replace-not-increment per ADR-056 §5.
 */
export interface MetricSeriesFact {
  metricName: string;
  /** The bucketing attributes the overlay reads. Null when absent. */
  type: string | null;
  decision: string | null;
  language: string | null;
  value: number;
}

/**
 * Bounded persisted fold state (ADR-056): scalars, small sets/maps, and ids
 * pointing to heavy data. Prompt, response, API-body, and tool-output content
 * stays at its source; fields an agent does not report remain null or zero.
 */
export interface CodingAgentSessionData {
  agent: string | null;
  sessionId: string | null;
  agentVersion: string | null;
  terminalType: string | null;
  entrypoint: string | null;
  /** Points to the final response body without copying it. */
  finalRequestId: string | null;
  /** Opaque provider identity only; raw email is never persisted here. */
  userId: string | null;
  parentSessionId: string | null;
  isFork: boolean;
  /** Repository identity is once-set; branch is last-write-wins. */
  repositoryHost: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  gitBranch: string | null;
  /** Bounded first-seen history used for pull-request mapping. */
  gitBranches: string[];
  gitWorktree: string | null;
  title: string | null;
  /** Persists title precedence across row read-back. */
  titleSource: SessionTitleSource | null;
  modelCalls: number;
  toolCalls: number;
  subAgents: number;
  /** Fold-only dedup state; projected output carries counts and types. */
  subAgentIds: string[];
  steps: SessionStep[];
  prompts: number;
  promptChars: number;
  responseChars: number;
  toolCounts: Record<string, number>;
  toolDurationMs: Record<string, number>;
  filesTouched: string[];
  skills: string[];
  subAgentTypes: string[];
  slashCommands: string[];
  models: string[];
  mcpServers: string[];
  mcpTools: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Registry-computed cost; reported agent cost remains separate. */
  costUsd: number;
  agentReportedCostUsd: number;
  modelCallMs: number;
  toolMs: number;
  ttftMsTotal: number;
  ttftSamples: number;
  /** Human approval wait, distinct from model and tool time. */
  blockedOnUserMs: number;
  activeTimeUserSec: number;
  activeTimeCliSec: number;
  toolResultBytes: number;
  toolInputBytes: number;
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;
  compactionTriggers: Record<string, number>;
  peakContextTokens: number;
  cacheRebuildCount: number;
  largestCacheRebuildTokens: number;
  /** Fold-only predecessor used to detect the next cache rebuild. */
  previousCallContextTokens: number;
  failedTools: number;
  errorTypes: Record<string, number>;
  apiErrors: number;
  rateLimited: number;
  /** Agent-reported rate-limit signals, separate from inferred HTTP 429s. */
  rateLimitEvents: number;
  retriesExhausted: number;
  retryMs: number;
  attempts: number;
  refusals: number;
  refusalCategories: string[];
  internalErrors: number;
  toolsDenied: number;
  toolsAborted: number;
  permissionMode: string | null;
  permissionChanges: number;
  hooksBlocked: number;
  hooksCancelled: number;
  hookMs: number;
  /** Bounded converged units; a repeated unit replaces rather than increments. */
  metricSeries: Record<string, MetricSeriesFact>;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  editsAccepted: number;
  editsRejected: number;
  languagesEdited: string[];
  atMentions: number;

  /** Final call only; earlier tool-use stops are intermediate. */
  stopReason: string | null;

  truncated: boolean;
}

/** Ordered steps retained in a bounded session summary. */
const MAX_STEPS = 100;
export const MAX_SET = 50;
const TITLE_RANK: Record<SessionTitleSource, number> = {
  prompt: 1,
  generated: 2,
  name: 3,
};
const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "refusal"]);
const CACHE_REBUILD_RATIO_THRESHOLD = 0.5;
const CACHE_REBUILD_MIN_TOKENS = 1_000;

/**
 * Owns the bounded state transitions shared by span and log projections.
 * It has no I/O and derives the same next state for the same inputs.
 */
export class CodingAgentSessionStateProjection {
  private constructor() {}

  static create(): CodingAgentSessionStateProjection {
    return new CodingAgentSessionStateProjection();
  }

  createInitCodingAgentSession(): CodingAgentSessionData {
    return {
      agent: null,
      sessionId: null,
      agentVersion: null,
      terminalType: null,
      entrypoint: null,
      finalRequestId: null,
      userId: null,
      parentSessionId: null,
      isFork: false,
      repositoryHost: null,
      repositoryOwner: null,
      repositoryName: null,
      gitBranch: null,
      gitBranches: [],
      gitWorktree: null,
      title: null,
      titleSource: null,

      modelCalls: 0,
      toolCalls: 0,
      subAgents: 0,
      subAgentIds: [],
      steps: [],
      prompts: 0,
      promptChars: 0,
      responseChars: 0,

      toolCounts: {},
      toolDurationMs: {},
      filesTouched: [],
      skills: [],
      subAgentTypes: [],
      slashCommands: [],
      models: [],
      mcpServers: [],
      mcpTools: [],

      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      agentReportedCostUsd: 0,

      modelCallMs: 0,
      toolMs: 0,
      ttftMsTotal: 0,
      ttftSamples: 0,
      blockedOnUserMs: 0,
      activeTimeUserSec: 0,
      activeTimeCliSec: 0,

      toolResultBytes: 0,
      toolInputBytes: 0,
      compactions: 0,
      compactionTokensBefore: 0,
      compactionTokensAfter: 0,
      compactionTriggers: {},
      peakContextTokens: 0,
      cacheRebuildCount: 0,
      largestCacheRebuildTokens: 0,
      previousCallContextTokens: 0,

      failedTools: 0,
      errorTypes: {},
      apiErrors: 0,
      rateLimited: 0,
      rateLimitEvents: 0,
      retriesExhausted: 0,
      retryMs: 0,
      attempts: 0,
      refusals: 0,
      refusalCategories: [],
      internalErrors: 0,

      toolsDenied: 0,
      toolsAborted: 0,
      permissionMode: null,
      permissionChanges: 0,
      hooksBlocked: 0,
      hooksCancelled: 0,
      hookMs: 0,

      metricSeries: {},
      linesAdded: 0,
      linesRemoved: 0,
      commits: 0,
      pullRequests: 0,
      editsAccepted: 0,
      editsRejected: 0,
      languagesEdited: [],
      atMentions: 0,

      stopReason: null,
      truncated: false,
    };
  }

  meanTtftMs(state: CodingAgentSessionData): number | null {
    return state.ttftSamples > 0 ? Math.round(state.ttftMsTotal / state.ttftSamples) : null;
  }

  cacheHitRate(state: CodingAgentSessionData): number | null {
    const total = state.cacheReadTokens + state.cacheCreationTokens + state.inputTokens;
    return total > 0 ? state.cacheReadTokens / total : null;
  }

  addToBoundedSet(set: string[], value: string): string[] {
    if (set.includes(value) || set.length >= MAX_SET) return set;
    return [...set, value];
  }

  string(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  scalarString(value: unknown): string | null {
    if (typeof value === "string") return value.length > 0 ? value : null;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
    return null;
  }

  number(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  incrementCounter(map: Record<string, number>, key: string, by = 1): Record<string, number> {
    if (map[key] === undefined && Object.keys(map).length >= MAX_SET) return map;
    return { ...map, [key]: (map[key] ?? 0) + by };
  }

  withTitle({
    state,
    value,
    source,
  }: {
    state: CodingAgentSessionData;
    value: string | null;
    source: SessionTitleSource;
  }): CodingAgentSessionData {
    const title = value?.trim() || null;
    if (title === null) return state;
    if (source === "prompt" && state.title !== null) return state;
    const current =
      state.titleSource !== null
        ? TITLE_RANK[state.titleSource]
        : state.title !== null
          ? TITLE_RANK.generated
          : 0;
    if (TITLE_RANK[source] < current) return state;
    return { ...state, title, titleSource: source };
  }

  private appendStep(
    steps: SessionStep[],
    step: { name: string; startedAtMs: number; failed: boolean },
  ): SessionStep[] {
    let index = steps.length;
    while (index > 0 && (steps[index - 1]?.startedAtMs ?? 0) > step.startedAtMs) {
      index--;
    }

    const previous = steps[index - 1];
    if (previous && previous.name === step.name) {
      const merged: SessionStep = {
        ...previous,
        count: previous.count + 1,
        // A run of five tests where the third broke is not a clean run.
        failed: previous.failed || step.failed,
      };
      return [...steps.slice(0, index - 1), merged, ...steps.slice(index)];
    }

    // A late arrival can also land just BEFORE an existing same-name step —
    // merging only backward would leave two adjacent same-name runs unmerged.
    const next = steps[index];
    if (next && next.name === step.name) {
      const merged: SessionStep = {
        ...next,
        startedAtMs: step.startedAtMs,
        count: next.count + 1,
        failed: next.failed || step.failed,
      };
      return [...steps.slice(0, index), merged, ...steps.slice(index + 1)];
    }

    if (steps.length >= MAX_STEPS) return steps;
    return [
      ...steps.slice(0, index),
      {
        name: step.name,
        count: 1,
        failed: step.failed,
        startedAtMs: step.startedAtMs,
      },
      ...steps.slice(index),
    ];
  }

  recordSubAgent(state: CodingAgentSessionData, agentId: string): Partial<CodingAgentSessionData> {
    if (state.subAgentIds.includes(agentId)) return {};
    if (state.subAgentIds.length >= MAX_SET) return {};
    const subAgentIds = [...state.subAgentIds, agentId];
    return { subAgentIds, subAgents: subAgentIds.length };
  }

  withIdentity(
    state: CodingAgentSessionData,
    attrs: Record<string, unknown>,
  ): CodingAgentSessionData {
    return {
      ...state,
      agentVersion:
        state.agentVersion ??
        this.string(attrs["app.version"]) ??
        this.string(attrs["service.version"]),
      terminalType: state.terminalType ?? this.string(attrs["terminal.type"]),
      entrypoint: state.entrypoint ?? this.string(attrs["app.entrypoint"]),
      // Claude stamps user identity on log events, not spans; other agents send
      // none at all, so a session they produce honestly keeps null here.
      // Opaque provider ids only — Claude Code's `user.id` hash, or Cowork's
      // account UUID / tagged account id. `user.email` also rides those events
      // but is raw human identity, and this value lands verbatim in a durable
      // row, so it is deliberately never read.
      userId:
        state.userId ??
        this.string(attrs["user.id"]) ??
        this.string(attrs["user.account_uuid"]) ??
        this.string(attrs["user.account_id"]),
      // Spawn lineage, for agents that stamp it. Once-set like the rest of the
      // identity: a session has ONE parent, and a fork stays a fork.
      //
      // Nothing observed so far stamps it. A session that spawned a sub-agent
      // with every enhanced-telemetry knob on carried neither key, while that
      // sub-agent's own `agent_id` does arrive and is counted by `seenSubAgent`.
      // So empty reads as "no lineage was reported", never as "this is a root
      // session": the two are indistinguishable from here.
      parentSessionId: state.parentSessionId ?? this.string(attrs.parent_session_id),
      isFork: state.isFork || this.scalarString(attrs.is_fork) === "true",
    };
  }

  foldModelCall(
    next: CodingAgentSessionData,
    attrs: Record<string, unknown>,
    fallbackDurationMs: number,
  ): CodingAgentSessionData {
    const agentId = this.string(attrs.agent_id);
    if (agentId !== null) Object.assign(next, this.recordSubAgent(next, agentId));
    const stopReason = this.string(attrs.stop_reason);
    const ttft = this.number(attrs.ttft_ms);
    const model = this.string(attrs.model) ?? this.string(attrs["gen_ai.request.model"]);
    const requestId = this.string(attrs.request_id);

    const cacheReadTokens = this.number(attrs.cache_read_tokens);
    const cacheCreationTokens = this.number(attrs.cache_creation_tokens);
    const contextTokens = cacheReadTokens + cacheCreationTokens;
    // The first call is never a "rebuild" — there is nothing to reuse yet,
    // so a cold cache isn't the session's fault. `previousCallContextTokens`
    // starts at 0, which doubles as that gate.
    const isRebuild =
      next.previousCallContextTokens > 0 &&
      cacheCreationTokens >= CACHE_REBUILD_MIN_TOKENS &&
      cacheCreationTokens / next.previousCallContextTokens >= CACHE_REBUILD_RATIO_THRESHOLD;

    return {
      ...next,
      modelCalls: next.modelCalls + 1,
      modelCallMs: next.modelCallMs + (this.number(attrs.duration_ms) || fallbackDurationMs),
      ttftMsTotal: next.ttftMsTotal + ttft,
      ttftSamples: next.ttftSamples + (ttft > 0 ? 1 : 0),
      // Attempts includes the first try, so attempts > modelCalls means the
      // session paid for retries somewhere.
      attempts: next.attempts + Math.max(1, this.number(attrs.attempt)),
      inputTokens: next.inputTokens + this.number(attrs.input_tokens),
      outputTokens: next.outputTokens + this.number(attrs.output_tokens),
      cacheReadTokens: next.cacheReadTokens + cacheReadTokens,
      cacheCreationTokens: next.cacheCreationTokens + cacheCreationTokens,
      peakContextTokens: Math.max(next.peakContextTokens, contextTokens),
      cacheRebuildCount: next.cacheRebuildCount + (isRebuild ? 1 : 0),
      largestCacheRebuildTokens: isRebuild
        ? Math.max(next.largestCacheRebuildTokens, cacheCreationTokens)
        : next.largestCacheRebuildTokens,
      previousCallContextTokens: contextTokens,
      models: model !== null ? this.addToBoundedSet(next.models, model) : next.models,
      // The pointer back to the body that ended the session. Last call wins.
      finalRequestId: requestId ?? next.finalRequestId,
      // Only the LAST call's stop reason is the session's: the earlier ones all
      // stop on `tool_use` by definition, since that is what drove the loop on.
      ...(stopReason !== null
        ? {
            stopReason,
            truncated: TRUNCATING_STOP_REASONS.has(stopReason),
          }
        : {}),
    };
  }

  foldToolInvocation(
    next: CodingAgentSessionData,
    {
      attrs,
      failed,
      toolMs,
      startedAtMs,
    }: {
      attrs: Record<string, unknown>;
      failed: boolean;
      toolMs: number;
      startedAtMs: number;
    },
  ): CodingAgentSessionData {
    const toolName = this.string(attrs.tool_name);

    const withTool: CodingAgentSessionData = {
      ...next,
      toolCalls: next.toolCalls + 1,
      failedTools: next.failedTools + (failed ? 1 : 0),
      toolMs: next.toolMs + toolMs,
    };

    if (toolName === null) return withTool;

    withTool.toolCounts = this.incrementCounter(next.toolCounts, toolName);
    if (toolMs > 0) {
      withTool.toolDurationMs = this.incrementCounter(next.toolDurationMs, toolName, toolMs);
    }

    // A sub-agent runs its OWN conversation and can do twenty reads of its own.
    // Splicing those into the session's steps would read as though the main thread
    // did them, flattening away the hierarchy. The sub-agent is already
    // represented by the step that SPAWNED it. `agent_id` is absent on the main
    // thread and present on every sub-agent span, so it is exactly the
    // discriminator. The work still counts toward the totals — it happened.
    const toolAgentId = this.string(attrs.agent_id);
    if (toolAgentId !== null) {
      Object.assign(withTool, this.recordSubAgent(withTool, toolAgentId));
    }
    if (toolAgentId === null) {
      withTool.steps = this.appendStep(next.steps, {
        name: toolName,
        startedAtMs,
        failed,
      });
    }

    const filePath = this.string(attrs.file_path);
    if (filePath !== null) {
      withTool.filesTouched = this.addToBoundedSet(next.filesTouched, filePath);
    }

    // A skill reaches the session two ways: the `skill_activated` event and the
    // Skill TOOL span. A skill the agent invoked proactively arrives on one path,
    // a `/slash` skill on the other — reading only one loses half of them.
    const skillName = this.string(attrs.skill_name);
    if (skillName !== null) {
      withTool.skills = this.addToBoundedSet(next.skills, skillName);
    }

    // An MCP call announces itself in its NAME — `mcp__<server>__<tool>` — and that
    // is the signal that actually arrives. Reading only the `mcp_server.name` /
    // `mcp_tool.name` attributes found nothing on real sessions: a session that had
    // plainly called an MCP server reported using none, because the agent doesn't
    // emit those attributes on the tool span. So parse the name first and treat the
    // attributes as a bonus for agents that DO send them.
    const fromName = parseMcpToolName(toolName);
    // Codex spells the server as a bare `mcp_server` on its tool_result events
    // (empty string for a builtin tool, which this.string() already reads as absent).
    const mcpServer =
      this.string(attrs["mcp_server.name"]) ??
      this.string(attrs.mcp_server) ??
      fromName?.server ??
      null;
    if (mcpServer !== null) {
      withTool.mcpServers = this.addToBoundedSet(next.mcpServers, mcpServer);
    }
    const mcpTool = this.string(attrs["mcp_tool.name"]) ?? fromName?.tool ?? null;
    if (mcpTool !== null) {
      withTool.mcpTools = this.addToBoundedSet(next.mcpTools, mcpTool);
    }

    return withTool;
  }
}
