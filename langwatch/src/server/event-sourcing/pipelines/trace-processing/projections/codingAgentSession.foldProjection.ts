import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "~/server/event-sourcing/projections/foldProjection.types";
import {
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  spanReceivedEventSchema,
  type LogRecordReceivedEvent,
  type MetricRecordReceivedEvent,
  type SpanReceivedEvent,
} from "../schemas/events";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  applyLogToCodingAgentSession,
  applyMetricToCodingAgentSession,
  applySpanToCodingAgentSession,
  isCodingAgentLogRecord,
  CODING_AGENT_SPAN_NAMES,
  createInitCodingAgentSession,
  isCodingAgentMetric,
} from "./services/coding-agent-session.derivation";
import type { CodingAgentSessionData } from "./services/coding-agent-session.types";

/**
 * The coding-agent session fold (ADR-040).
 *
 * One row per SESSION, folded from that session's spans, logs AND metrics — all
 * three, because the agent splits the story across them. See the derivation for
 * why each is load-bearing.
 *
 * Writes `coding_agent_sessions` (migration 00042). A trace that is not a coding
 * agent never produces a row: the store drops the record when the fold saw no
 * model calls and no tool runs, so an ordinary LLM trace costs one name
 * comparison per span and nothing else.
 */
const codingAgentSessionEvents = [
  spanReceivedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
] as const;

/** The `event.name` attribute off a raw log record, if it carries one. */
function readEventName(attributes: unknown): string | null {
  const value = (attributes as Record<string, unknown> | undefined)?.[
    "event.name"
  ];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Schema-snapshot version (calendar date). Bump when the derivation changes. */
export const CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST =
  "2026-07-11" as const;

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

/**
 * The fold's state: the derived session plus the bookkeeping the abstract fold
 * needs. Deliberately flat — the session data is already bounded, so the whole
 * state is O(1) in the length of the session.
 */
export interface CodingAgentSessionState extends CodingAgentSessionData {
  traceId: string;
  /** Earliest span start seen. 0 is the "no spans yet" sentinel. */
  startedAtMs: number;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

export class CodingAgentSessionFoldProjection
  extends AbstractFoldProjection<
    CodingAgentSessionState,
    typeof codingAgentSessionEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements
    FoldEventHandlers<typeof codingAgentSessionEvents, CodingAgentSessionState>
{
  readonly name = "codingAgentSession";
  readonly version = CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<CodingAgentSessionState>;

  protected readonly events = codingAgentSessionEvents;

  /**
   * The row is an aggregate, not a copy, so it cannot be read back into state
   * (the counters are there, but the step ordering and the "first seen" identity
   * rules are not reconstructable from it). On a cache miss the executor must
   * rebuild from the event log, or a partial batch would overwrite a complete
   * session with only the events in that batch.
   */
  override options: FoldProjectionOptions = { refoldOnStoreMiss: true };

  constructor(deps: { store: FoldProjectionStore<CodingAgentSessionState> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState(): CodingAgentSessionState {
    return {
      ...createInitCodingAgentSession(),
      traceId: "",
      startedAtMs: 0,
      createdAt: 0,
      updatedAt: 0,
      LastEventOccurredAt: 0,
    };
  }

  handleTraceSpanReceived(
    event: SpanReceivedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    // Gate on the RAW span name, before any decoding.
    //
    // Every trace in the project flows through this fold, and normalizing a span
    // runs the entire canonicalisation registry. Without this check an ordinary
    // chat trace would pay that cost on every one of its spans only to discover
    // at the end that it is not a coding agent. One set lookup instead.
    const rawName = (event.data.span as { name?: unknown } | undefined)?.name;
    if (
      typeof rawName !== "string" ||
      !CODING_AGENT_SPAN_NAMES.has(rawName)
    ) {
      return state;
    }

    const span = spanNormalizationPipelineService.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );

    const next = applySpanToCodingAgentSession({ state, span });

    return {
      ...state,
      ...next,
      traceId: state.traceId || span.traceId,
      // The session starts when its earliest span does — which is not
      // necessarily the first span to ARRIVE, since spans are exported in
      // batches and can land out of order.
      startedAtMs:
        state.startedAtMs === 0
          ? span.startTimeUnixMs
          : Math.min(state.startedAtMs, span.startTimeUnixMs),
    };
  }

  handleTraceLogRecordReceived(
    event: LogRecordReceivedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    // Scope FIRST (cheap), then the event name — because scope alone cannot
    // work. Codex names its instrumentation scope after whatever `service_name`
    // the user configured, so there is no stable string to match, and a
    // scope-only gate silently drops every Codex record. It was already dropping
    // every opencode record for the simpler reason that `com.opencode` was not
    // in the set.
    if (
      !isCodingAgentLogRecord({
        scopeName: event.data.scopeName,
        eventName: readEventName(event.data.attributes),
      })
    ) {
      return state;
    }

    const next = applyLogToCodingAgentSession({ state, data: event.data });
    return {
      ...state,
      ...next,
      traceId: state.traceId || event.data.traceId,
    };
  }

  handleTraceMetricRecordReceived(
    event: MetricRecordReceivedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    if (!isCodingAgentMetric(event.data.metricName)) return state;

    const next = applyMetricToCodingAgentSession({ state, data: event.data });
    return {
      ...state,
      ...next,
      traceId: state.traceId || event.data.traceId,
    };
  }
}

/**
 * The row that lands in `coding_agent_sessions` (migration 00042). Field names
 * mirror the ClickHouse columns 1:1 so the repository's record literal is a
 * straight mapping.
 */
export interface CodingAgentSessionRow {
  tenantId: string;
  traceId: string;
  version: string;
  startedAtMs: number;

  agent: string;
  agentVersion: string;
  sessionId: string;
  finalRequestId: string;
  userId: string;
  terminalType: string;
  entrypoint: string;

  modelCalls: number;
  toolCalls: number;
  subAgents: number;
  prompts: number;
  promptChars: number;
  responseChars: number;
  /** `(name, count, failed)`, in the order they happened. */
  steps: [string, number, boolean][];

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
  costUsd: number;

  modelCallMs: number;
  toolMs: number;
  ttftMsTotal: number;
  ttftSamples: number;
  blockedOnUserMs: number;
  activeTimeUserSec: number;
  activeTimeCliSec: number;

  toolResultBytes: number;
  toolInputBytes: number;
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;

  failedTools: number;
  errorTypes: Record<string, number>;
  apiErrors: number;
  rateLimited: number;
  retriesExhausted: number;
  retryMs: number;
  attempts: number;
  refusals: number;
  refusalCategories: string[];
  internalErrors: number;

  toolsDenied: number;
  toolsAborted: number;
  permissionMode: string;
  permissionChanges: number;
  hooksBlocked: number;
  hooksCancelled: number;
  hookMs: number;

  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  editsAccepted: number;
  editsRejected: number;
  languagesEdited: string[];
  atMentions: number;

  stopReason: string;
  truncated: boolean;
}

/**
 * Project the fold state into the row. Every heavy thing stays out: the row
 * carries counters, bounded sets, and the IDS that reach the spans, the logs and
 * the response body — never their contents.
 */
export function projectCodingAgentSessionToRow({
  state,
  tenantId,
  version,
}: {
  state: CodingAgentSessionState;
  tenantId: string;
  version: string;
}): CodingAgentSessionRow {
  return {
    tenantId,
    traceId: state.traceId,
    version,
    startedAtMs: state.startedAtMs,

    agent: state.agent ?? "",
    agentVersion: state.agentVersion ?? "",
    sessionId: state.sessionId ?? "",
    finalRequestId: state.finalRequestId ?? "",
    userId: "",
    terminalType: state.terminalType ?? "",
    entrypoint: state.entrypoint ?? "",

    modelCalls: state.modelCalls,
    toolCalls: state.toolCalls,
    subAgents: state.subAgents,
    prompts: state.prompts,
    promptChars: state.promptChars,
    responseChars: state.responseChars,
    steps: state.steps.map((s) => [s.name, s.count, s.failed]),

    toolCounts: state.toolCounts,
    toolDurationMs: state.toolDurationMs,
    filesTouched: state.filesTouched,
    skills: state.skills,
    subAgentTypes: state.subAgentTypes,
    slashCommands: state.slashCommands,
    models: state.models,
    mcpServers: state.mcpServers,
    mcpTools: state.mcpTools,

    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheCreationTokens: state.cacheCreationTokens,
    costUsd: state.costUsd,

    modelCallMs: state.modelCallMs,
    toolMs: state.toolMs,
    ttftMsTotal: state.ttftMsTotal,
    ttftSamples: state.ttftSamples,
    blockedOnUserMs: state.blockedOnUserMs,
    activeTimeUserSec: state.activeTimeUserSec,
    activeTimeCliSec: state.activeTimeCliSec,

    toolResultBytes: state.toolResultBytes,
    toolInputBytes: state.toolInputBytes,
    compactions: state.compactions,
    compactionTokensBefore: state.compactionTokensBefore,
    compactionTokensAfter: state.compactionTokensAfter,

    failedTools: state.failedTools,
    errorTypes: state.errorTypes,
    apiErrors: state.apiErrors,
    rateLimited: state.rateLimited,
    retriesExhausted: state.retriesExhausted,
    retryMs: state.retryMs,
    attempts: state.attempts,
    refusals: state.refusals,
    refusalCategories: state.refusalCategories,
    internalErrors: state.internalErrors,

    toolsDenied: state.toolsDenied,
    toolsAborted: state.toolsAborted,
    permissionMode: state.permissionMode ?? "",
    permissionChanges: state.permissionChanges,
    hooksBlocked: state.hooksBlocked,
    hooksCancelled: state.hooksCancelled,
    hookMs: state.hookMs,

    linesAdded: state.linesAdded,
    linesRemoved: state.linesRemoved,
    commits: state.commits,
    pullRequests: state.pullRequests,
    editsAccepted: state.editsAccepted,
    editsRejected: state.editsRejected,
    languagesEdited: state.languagesEdited,
    atMentions: state.atMentions,

    stopReason: state.stopReason ?? "",
    truncated: state.truncated,
  };
}
