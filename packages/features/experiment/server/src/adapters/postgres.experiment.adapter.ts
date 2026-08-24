import type { ExperimentService as ExperimentServiceContract } from "@langwatch/experiment-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PrismaExperimentRepository,
  type ExperimentDatabase,
} from "../repositories/prisma/prisma.experiment.repository";
import {
  ClickHouseExperimentRunRepository,
} from "../repositories/clickhouse/clickhouse.experiment-run.repository";
import {
  UnavailableExperimentExecutionPort,
} from "../execution/experiment-execution.port";
import { ExperimentService } from "../services/experiment.service";

export type PostgresExperimentAdapterOptions = {
  /** The primary Postgres store plus workflow-version metadata for run reads. */
  database: ExperimentDatabase & Pick<PrismaClient, "workflowVersion">;
  /** `null` explicitly represents a deployment without ClickHouse. */
  resolveClickHouseClient: (projectId: string) => Promise<{
    query(input: {
      query: string;
      query_params: Record<string, unknown>;
      format: "JSONEachRow";
    }): Promise<{ json<T>(): Promise<T[]> }>;
  } | null>;
  tupleParam: (values: string[]) => unknown;
  runHistoryTelemetry: {
    trace<T>(
      input: {
        name: string;
        attributes: Record<string, string | number>;
      },
      operation: () => Promise<T>,
    ): Promise<T>;
    warnOldRuns(input: {
      projectId: string;
      oldestRunAgeDays: number;
      runCount: number;
      occurredAtBufferHours: number;
    }): void;
    error(
      input: {
        projectId: string;
        experimentId?: string;
        runId?: string;
        error: unknown;
      },
      message: string,
    ): void;
    warn(input: { projectId: string; error: unknown }, message: string): void;
  };
  /** App-owned Eventing dispatchers. Omitted only by runtimes with no worker pipeline. */
  execution?: {
    startExperimentRun(input: {
      tenantId: string;
      runId: string;
      experimentId: string;
      workflowVersionId?: string | null;
      total: number;
      targets: Array<{
        id: string;
        name: string;
        type: string;
        promptId?: string | null;
        promptVersion?: number | null;
        agentId?: string | null;
        evaluatorId?: string | null;
        model?: string | null;
        metadata?: Record<string, string | number | boolean> | null;
      }>;
      occurredAt: number;
    }): Promise<void>;
    recordTargetResult(input: {
      tenantId: string;
      runId: string;
      experimentId: string;
      index: number;
      targetId: string;
      entry: Record<string, unknown>;
      predicted?: Record<string, unknown> | null;
      cost?: number | null;
      duration?: number | null;
      error?: string | null;
      domainError?: Record<string, unknown> | null;
      traceId?: string | null;
      targets?: Array<{
        id: string;
        name: string;
        type: string;
        promptId?: string | null;
        promptVersion?: number | null;
        agentId?: string | null;
        evaluatorId?: string | null;
        model?: string | null;
        metadata?: Record<string, string | number | boolean> | null;
      }>;
      occurredAt: number;
    }): Promise<void>;
    recordEvaluatorResult(input: {
      tenantId: string;
      runId: string;
      experimentId: string;
      index: number;
      targetId: string;
      evaluatorId: string;
      evaluatorName?: string | null;
      status: "processed" | "error" | "skipped";
      score?: number | null;
      label?: string | null;
      passed?: boolean | null;
      details?: string | null;
      cost?: number | null;
      inputs?: Record<string, unknown> | null;
      duration?: number | null;
      occurredAt: number;
    }): Promise<void>;
    completeExperimentRun(input: {
      tenantId: string;
      runId: string;
      experimentId: string;
      finishedAt?: number | null;
      stoppedAt?: number | null;
      occurredAt: number;
    }): Promise<void>;
  };
  slugify: (value: string) => string;
  newId: () => string;
  now?: () => Date;
};

export class PostgresExperimentAdapter {
  static create(
    options: PostgresExperimentAdapterOptions,
  ): ExperimentServiceContract {
    return ExperimentService.create({
      ...options,
      repository: PrismaExperimentRepository.create(options.database),
      runRepository: ClickHouseExperimentRunRepository.create({
        database: options.database,
        resolveClient: options.resolveClickHouseClient,
        tupleParam: options.tupleParam,
        telemetry: options.runHistoryTelemetry,
      }),
      execution:
        options.execution ?? new UnavailableExperimentExecutionPort(),
    });
  }
}
