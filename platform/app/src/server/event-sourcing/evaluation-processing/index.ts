import {
  type ClickHouseClient,
  clickhouseReplacing,
  type FoldStateCache,
  noFoldStateCache,
} from "@langwatch/clickhouse";
import {
  ConfigurationError,
  definePipeline,
  type GroupKey,
  type Metrics,
  type Mount,
  type PipelineChainWithId,
  validateMount,
} from "@langwatch/event-sourcing";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  createEvaluationTriggerMatchSubscriber,
  createGraphTriggerActivitySubscriber,
  type EvaluationTriggerMatchPorts,
  type GraphTriggerActivityPorts,
} from "../automations/subscribers";
import {
  applyEvaluationReported,
  applyEvaluationStarted,
  initEvaluationState,
} from "./evaluationAnalytics.projection";
import {
  EVALUATION_PIPELINE_NAME,
  EVALUATION_PIPELINE_PREFIX,
  evaluationEvents,
} from "./events";
import { reportEvaluation } from "./report.command";
import { type EvaluationState, evaluationStateSchema } from "./schema";
import type { ExecuteEvaluationDeps } from "./services/executeEvaluation";
import { startEvaluation } from "./start.command";
import {
  type EvaluationAnalyticsColumns,
  evaluationAnalyticsRow,
  evaluationAnalyticsTable,
} from "./table";

/**
 * `evaluation_analytics`'s live stamp, carried over from
 * `event-sourcing.old`'s `EvaluationAnalyticsFoldProjection` (still what
 * production writes today). Pinned per ADR-105 decision 9 — deriving a fresh
 * hash here would fail the version gate on every row already stored.
 */
const EVALUATION_ANALYTICS_VERSION_PIN = "2026-07-27";

/** Deployed `ORDER BY (TenantId, OccurredAt, EvaluationId)` is time-leading, so
 * the read is a seek only behind this bound; a windowed miss retries
 * unwindowed, so an evaluation older than the window still reads back. */
const EVALUATION_ANALYTICS_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** A fold reads its own state back, so it gets one lane per evaluation. A
 * command lane is named, letting the SDK's two report phases run concurrently. */
function evaluationScope(evaluationId: string) {
  return {
    kind: "aggregate",
    aggregateType: EVALUATION_PIPELINE_NAME,
    aggregateId: evaluationId,
  } as const;
}

export function evaluationCommandGroupKey(args: {
  tenantId: string;
  command: "start" | "report";
  evaluationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: args.command },
    scope: evaluationScope(args.evaluationId),
  };
}

export function evaluationAnalyticsGroupKey(args: {
  tenantId: string;
  evaluationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "evaluationAnalytics" },
    scope: evaluationScope(args.evaluationId),
  };
}

/** Refused at composition, never at the first delivery (ADR-106). */
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `evaluation-processing's ${projection} mount is illegal: ${violations
        .map((violation) => `${violation.rule} — ${violation.message}`)
        .join("; ")}`,
      { pipeline: EVALUATION_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

export interface EvaluationProcessingDeps {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
  readonly cache?: FoldStateCache<EvaluationState>;
  /**
   * What the `execute` command will run on once it can be mounted. Not mounted
   * yet: `services/executeEvaluation.ts` samples with `Math.random()`, so a
   * retried dispatch would sample differently and emit an event the first
   * attempt suppressed — ADR-107 decision 15 requires a command to be a
   * function of its input.
   */
  readonly executeEvaluation: ExecuteEvaluationDeps;
  readonly triggerMatch?: EvaluationTriggerMatchPorts;
  readonly graphTriggerActivity?: GraphTriggerActivityPorts;
  readonly billingPoke?: { handle(event: { tenantId: string }): Promise<void> };
}

type EvaluationChain = PipelineChainWithId<
  typeof EVALUATION_PIPELINE_NAME,
  typeof EVALUATION_PIPELINE_PREFIX,
  typeof evaluationEvents
>;

/** Both are cross-pipeline-authored subscribers (automations owns the
 * behaviour), mounted natively here against evaluation-processing's own
 * `reported` event — the only terminal outcome this vocabulary declares. */
function mountAutomationsSubscribers(
  chain: EvaluationChain,
  deps: EvaluationProcessingDeps,
): EvaluationChain {
  let next = chain;
  if (deps.triggerMatch) {
    const subscriber = createEvaluationTriggerMatchSubscriber({
      eventTypes: ["reported"],
      isTerminalStatus: () => true,
      ports: deps.triggerMatch,
    });
    next = next.withSubscriber("triggerMatch", {
      on: {
        reported: (data, ctx) =>
          subscriber.handle(
            {
              type: "reported",
              tenantId: ctx.tenantId,
              aggregateId: data.evaluationId,
              occurredAt: ctx.now,
              data,
            },
            { tenantId: ctx.tenantId },
          ),
      },
    });
  }
  if (deps.graphTriggerActivity) {
    const subscriber = createGraphTriggerActivitySubscriber({
      eventTypes: ["reported"],
      ports: deps.graphTriggerActivity,
    });
    next = next.withSubscriber("graphTriggerActivity", {
      on: {
        reported: (_data, ctx) =>
          subscriber.handle(
            { type: "reported", tenantId: ctx.tenantId, occurredAt: ctx.now },
            { tenantId: ctx.tenantId },
          ),
      },
    });
  }
  return next;
}

/** The whole topology: two commands, one fold, its store beside it. */
export function evaluationProcessing(deps: EvaluationProcessingDeps) {
  const store = clickhouseReplacing<
    EvaluationState,
    EvaluationAnalyticsColumns
  >({
    client: deps.client,
    table: evaluationAnalyticsTable,
    version: EVALUATION_ANALYTICS_VERSION_PIN,
    key: "EvaluationId",
    stateVersionColumn: "Version",
    row: evaluationAnalyticsRow,
    cache: deps.cache ?? noFoldStateCache(),
    retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    readWindow: {
      column: "OccurredAt",
      lookbackMs: EVALUATION_ANALYTICS_READ_WINDOW_MS,
    },
  });
  assertMountIsLegal("evaluationAnalytics", {
    projection: "fold",
    store: store.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  let chain = definePipeline(EVALUATION_PIPELINE_NAME)
    .prefix(EVALUATION_PIPELINE_PREFIX)
    .events(evaluationEvents)
    .id({
      started: (data) => data.evaluationId,
      reported: (data) => data.evaluationId,
    })
    .withCommand("start", {
      input: evaluationEvents.started,
      handle: startEvaluation,
    })
    .withCommand("report", {
      input: evaluationEvents.reported,
      handle: reportEvaluation,
    })
    .withFold("evaluationAnalytics", {
      state: evaluationStateSchema,
      init: initEvaluationState,
      pin: EVALUATION_ANALYTICS_VERSION_PIN,
      on: {
        started: applyEvaluationStarted,
        reported: applyEvaluationReported,
      },
      store,
    });

  chain = mountAutomationsSubscribers(chain, deps);

  if (deps.billingPoke) {
    const billingPoke = deps.billingPoke;
    chain = chain.withSubscriber("billingMeterPoke", {
      on: {
        // `reported` is the only evaluation event the billable-events meter
        // records — `started` bills nothing and would mint a job that changes
        // no total.
        reported: (_data, ctx) =>
          billingPoke.handle({ tenantId: ctx.tenantId }),
      },
    });
  }

  return chain.build({ metrics: deps.metrics });
}
