import {
  type ClickHouseClient,
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
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
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
import {
  type ExecuteEvaluationDeps,
  executeEvaluation,
  executeEvaluationInputSchema,
} from "./services/executeEvaluation";
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
  command: "start" | "report" | "execute";
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
   * What the `execute` command runs on — monitors, the two trace readers, the
   * execution service, the cost recorder and the two optional function ports.
   * Named here rather than hidden in the composition root: the layer-3 services
   * stay services, and this file cannot drift from what the command takes
   * (ADR-102 "What does not move").
   */
  readonly executeEvaluation: ExecuteEvaluationDeps;
}

/** The whole topology: three commands, one fold, its store beside it. */
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
    cache: deps.cache,
    retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
  });
  assertMountIsLegal("evaluationAnalytics", {
    projection: "fold",
    store: store.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  return definePipeline(EVALUATION_PIPELINE_NAME)
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
    })
    .build({ metrics: deps.metrics });
}
