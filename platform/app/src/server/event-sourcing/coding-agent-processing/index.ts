import {
  type ClickHouseClient,
  clickhouseAppend,
  clickhouseReplacing,
  type FoldStateCache,
} from "@langwatch/clickhouse";
import {
  ConfigurationError,
  definePipeline,
  type GroupKey,
  type Metrics,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";
import {
  applyLogFactsContributed,
  applyMetricFactsContributed,
  applySpanFactsContributed,
  CODING_AGENT_SESSION_STATE_VERSION,
  codingAgentSessionRow,
  initCodingAgentSessionState,
} from "./codingAgentSession.projection";
import {
  mapLogTraceSession,
  mapSpanTraceSession,
  toTraceSessionRow,
} from "./codingAgentTraceSessions.projection";
import { contributeLogFacts } from "./contributeLogFacts.command";
import { contributeMetricFacts } from "./contributeMetricFacts.command";
import { contributeSpanFacts } from "./contributeSpanFacts.command";
import {
  CODING_AGENT_SESSION_PIPELINE_NAME,
  CODING_AGENT_SESSION_PIPELINE_PREFIX,
  codingAgentSessionEvents,
} from "./events";
import {
  type CodingAgentSessionState,
  codingAgentSessionStateSchema,
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./schema";
import {
  mapSessionMetricSeries,
  toSessionMetricSeriesRow,
} from "./sessionMetricSeries.projection";
import {
  codingAgentSessionsTable,
  codingAgentTraceSessionsTable,
  sessionMetricSeriesTable,
} from "./table";

/** Every lane is session-scoped: each member consumes this aggregate's own committed events (ADR-100). */
function sessionScope(sessionId: string) {
  return {
    kind: "aggregate",
    aggregateType: CODING_AGENT_SESSION_PIPELINE_NAME,
    aggregateId: sessionId,
  } as const;
}

export function codingAgentSessionGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "codingAgentSession" },
    scope: sessionScope(args.sessionId),
  };
}

export function codingAgentTraceSessionsGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "codingAgentTraceSessions" },
    scope: sessionScope(args.sessionId),
  };
}

export function sessionMetricSeriesGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "sessionMetricSeries" },
    scope: sessionScope(args.sessionId),
  };
}

export function codingAgentContributionCommandGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly command:
    | "contributeSpanFacts"
    | "contributeLogFacts"
    | "contributeMetricFacts";
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: args.command },
    scope: sessionScope(args.sessionId),
  };
}

/** Refused at composition, never at the first delivery (ADR-106). */
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `coding-agent-processing's ${projection} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: CODING_AGENT_SESSION_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

export function createCodingAgentProcessingPipeline(deps: {
  readonly client: ClickHouseClient;
  readonly cache?: FoldStateCache<CodingAgentSessionState>;
  readonly metrics?: Metrics;
}) {
  const sessionsStore = clickhouseReplacing({
    client: deps.client,
    table: codingAgentSessionsTable,
    version: CODING_AGENT_SESSION_STATE_VERSION,
    key: "SessionId",
    stateVersionColumn: "Version",
    row: codingAgentSessionRow,
    cache: deps.cache,
  });
  const traceSessionsStore = clickhouseAppend({
    client: deps.client,
    table: codingAgentTraceSessionsTable,
    toRow: toTraceSessionRow,
  });
  const metricSeriesStore = clickhouseAppend({
    client: deps.client,
    table: sessionMetricSeriesTable,
    toRow: toSessionMetricSeriesRow,
  });

  assertMountIsLegal("codingAgentSession", {
    projection: "fold",
    store: sessionsStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });
  assertMountIsLegal("codingAgentTraceSessions", {
    projection: "map",
    store: traceSessionsStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });
  assertMountIsLegal("sessionMetricSeries", {
    projection: "map",
    store: metricSeriesStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  return definePipeline(CODING_AGENT_SESSION_PIPELINE_NAME)
    .prefix(CODING_AGENT_SESSION_PIPELINE_PREFIX)
    .events(codingAgentSessionEvents)
    .id({
      spanFactsContributed: (d) => d.sessionId,
      logFactsContributed: (d) => d.sessionId,
      metricFactsContributed: (d) => d.sessionId,
    })
    .withCommand("contributeSpanFacts", {
      input: spanFactsContributionSchema,
      handle: contributeSpanFacts,
    })
    .withCommand("contributeLogFacts", {
      input: logFactsContributionSchema,
      handle: contributeLogFacts,
    })
    .withCommand("contributeMetricFacts", {
      input: metricFactsContributionSchema,
      handle: contributeMetricFacts,
    })
    .withFold("codingAgentSession", {
      state: codingAgentSessionStateSchema,
      init: initCodingAgentSessionState,
      pin: CODING_AGENT_SESSION_STATE_VERSION,
      on: {
        spanFactsContributed: applySpanFactsContributed,
        logFactsContributed: applyLogFactsContributed,
        metricFactsContributed: applyMetricFactsContributed,
      },
      store: sessionsStore,
    })
    .withMap("codingAgentTraceSessions", {
      on: {
        spanFactsContributed: mapSpanTraceSession,
        logFactsContributed: mapLogTraceSession,
      },
      store: traceSessionsStore,
    })
    .withMap("sessionMetricSeries", {
      on: { metricFactsContributed: mapSessionMetricSeries },
      store: metricSeriesStore,
    })
    .build({ metrics: deps.metrics });
}
