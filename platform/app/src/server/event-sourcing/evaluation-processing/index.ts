import type { ClickHouseClient, FoldStateCache } from "@langwatch/clickhouse";
import { clickhouseReplacing } from "@langwatch/clickhouse";
import type { GroupKey, Metrics, Mount } from "@langwatch/event-sourcing";
import {
  ConfigurationError,
  createFoldExecutor,
  validateMount,
} from "@langwatch/event-sourcing";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { type EvaluationState, evaluation } from "./aggregate";
import { evaluationAnalytics } from "./projection";
import {
  type EvaluationAnalyticsColumns,
  evaluationAnalyticsRow,
  evaluationAnalyticsTable,
} from "./table";

export type {
  EvaluationAggregate,
  EvaluationEvent,
  EvaluationReportedData,
  EvaluationStartedData,
  EvaluationState,
  EvaluationStatus,
} from "./aggregate";
export {
  applyEvaluationReported,
  applyEvaluationStarted,
  EVALUATION_STATUSES,
  evaluation,
  evaluationReportedDataSchema,
  evaluationStartedDataSchema,
  evaluationStateSchema,
  isTerminalEvaluationStatus,
} from "./aggregate";
export { evaluationAnalytics } from "./projection";
export type {
  ExecuteEvaluationDeps,
  ExecuteEvaluationInput,
} from "./services/executeEvaluation";
export {
  executeEvaluation,
  executeEvaluationInputSchema,
} from "./services/executeEvaluation";
export type { EvaluationAnalyticsColumns } from "./table";
export { evaluationAnalyticsRow, evaluationAnalyticsTable } from "./table";
export { EVALUATION_PROCESSING_TYPE_STRINGS } from "./typeStrings.snapshot";

/** A fold reads its own state back, so it gets one lane per evaluation. A
 * command lane is named, letting the SDK's two report phases run concurrently. */
function evaluationScope(evaluationId: string) {
  return {
    kind: "aggregate",
    aggregateType: evaluation.name,
    aggregateId: evaluationId,
  } as const;
}

export function evaluationCommandGroupKey(args: {
  tenantId: string;
  command: keyof typeof evaluation.commands;
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
    lane: { kind: "fold", name: evaluationAnalytics.name },
    scope: evaluationScope(args.evaluationId),
  };
}

/** Refused at composition, never at the first delivery (ADR-106). */
export function legalMount(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `evaluation-processing's ${projection} mount is illegal: ${violations
        .map((violation) => `${violation.rule} — ${violation.message}`)
        .join("; ")}`,
      { pipeline: "evaluation_processing", projection, violations },
    );
  }
  return mount;
}

export interface EvaluationProcessingDeps {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
  readonly cache?: FoldStateCache<EvaluationState>;
}

/** The whole topology: one aggregate, one fold, its store beside it. */
export function evaluationProcessing(deps: EvaluationProcessingDeps) {
  return {
    aggregate: evaluation,
    commandGroupKey: evaluationCommandGroupKey,
    folds: {
      evaluationAnalytics: {
        projection: evaluationAnalytics,
        groupKey: evaluationAnalyticsGroupKey,
        mount: legalMount("evaluationAnalytics", {
          projection: "fold",
          store: "replace",
          scope: "aggregate",
          collapse: "batch",
        }),
        executor: createFoldExecutor({
          store: clickhouseReplacing<
            EvaluationState,
            EvaluationAnalyticsColumns
          >({
            client: deps.client,
            table: evaluationAnalyticsTable,
            version: evaluationAnalytics.version,
            key: "EvaluationId",
            stateVersionColumn: "Version",
            row: evaluationAnalyticsRow,
            cache: deps.cache,
            retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
          }),
          init: evaluationAnalytics.init,
          apply: evaluationAnalytics.apply,
          stateVersion: evaluationAnalytics.version,
          projectionName: evaluationAnalytics.name,
          metrics: deps.metrics,
        }),
      },
    },
  };
}
