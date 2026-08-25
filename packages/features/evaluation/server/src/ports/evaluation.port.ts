import type { WorkflowService } from "@langwatch/workflow-contract";
import type { ExecuteEvaluationCommand } from "@langwatch/evaluation-contract";
import type { EvaluationExecutionResult } from "@langwatch/evaluation-contract";

/** The existing trace/evaluator engine is injected at the process boundary. */
export abstract class EvaluationExecutionPort {
  abstract execute(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult>;
}

export type EvaluationFeatureDependencies = {
  workflows: WorkflowService;
};

/** Physical retention horizon used to prune ClickHouse partitions safely. */
export abstract class EvaluationRetentionFloorPort {
  abstract getFloorMs(input: {
    table: "evaluation_runs";
    tenantId: string;
  }): Promise<number>;
}

export type EvaluationClickHouseResult = {
  json<T>(): Promise<T[]>;
};

export type EvaluationClickHouseClient = {
  insert(input: {
    table: string;
    values: unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<EvaluationClickHouseResult>;
};

export type EvaluationClickHouseResolver = (
  tenantId: string,
) => Promise<EvaluationClickHouseClient>;
