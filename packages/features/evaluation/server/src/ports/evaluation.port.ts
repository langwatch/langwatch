import type { ExecuteEvaluationCommand } from "@langwatch/evaluation-contract";
import type { EvaluationExecutionResult } from "@langwatch/evaluation-contract";
import type {
  ExecuteEvaluationCommandData,
  EvaluationProcessingEvent,
} from "@langwatch/evaluation-contract";
import type { ClickHouseSettings } from "@clickhouse/client";

/** The existing trace/evaluator engine is injected at the process boundary. */
export abstract class EvaluationExecutionPort {
  abstract execute(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult>;
}

/** Executes Evaluation's external-work intent behind the process boundary. */
export abstract class EvaluationExecutionIntentPort {
  abstract execute(input: ExecuteEvaluationCommandData): Promise<EvaluationProcessingEvent[]>;
}

/**
 * Runs external evaluation work and its associated cost write under one
 * durable Evaluation receipt. A redelivery receives the recorded outcome
 * instead of calling an evaluator or creating a second cost row.
 */
export abstract class EvaluationExecutionReceiptPort {
  abstract execute(input: {
    tenantId: string;
    evaluationId: string;
    operationKey: string;
    command: ExecuteEvaluationCommand;
    cost: {
      isGuardrail: boolean;
      evaluatorName: string;
      evaluatorId: string;
      traceId: string;
    };
  }): Promise<{
    result: EvaluationExecutionResult;
    costId: string | null;
  }>;
}

export interface ExecuteEvaluationCommandDeps {
  monitors: import("./evaluation-execution.port").EvaluationMonitorLookupPort;
  traces: import("./evaluation-execution.port").EvaluationTraceEvidencePort;
  executionReceipt: EvaluationExecutionReceiptPort;
  azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
  settingsRecovery: EvaluationSettingsRecoveryPort;
  inputsOffload: EvaluationInputsOffloadPort;
}

/** Resolves Evaluation-owned durable input markers at the read boundary. */
export abstract class EvaluationInputsResolutionPort {
  abstract tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null>;
}

/**
 * Applies the shared analytics attribute retention policy at the Evaluation
 * projection boundary. Trace owns the current policy implementation.
 */
export abstract class EvaluationAnalyticsAttributePolicy {
  abstract trim(attributes: Record<string, string>): Record<string, string>;
}

/** Persists the billable cost of a completed Evaluation execution. */
export abstract class EvaluationCostRecorderPort {
  abstract recordCost(input: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    idempotencyKey: string;
    amount: number;
    currency: string;
  }): Promise<string>;
}

/** Stores Evaluation-owned oversized input payloads behind durable infrastructure. */
export abstract class EvaluationInputStoragePort {
  abstract store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;

  abstract tryRead(input: {
    tenantId: string;
    id: string;
  }): Promise<AsyncIterable<Uint8Array> | null>;
}

/** Applies the operator-controlled payload-offload availability switch. */
export abstract class EvaluationInputOffloadAvailabilityPort {
  abstract isDisabled(): Promise<boolean>;
}

/** Resolves the Azure Safety provider credentials for an Evaluation tenant. */
export abstract class EvaluationAzureSafetyCredentialsPort {
  abstract tryGetForTenant(input: { tenantId: string }): Promise<Record<string, string> | null>;
}

/** Reads the Evaluation settings-recovery rollout switch. */
export abstract class EvaluationSettingsRecoveryPort {
  abstract isDisabled(): Promise<boolean>;
}

/** Offloads an Evaluation result's inputs before the event is created. */
export abstract class EvaluationInputsOffloadPort {
  abstract offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

/** Physical retention horizon used to prune ClickHouse partitions safely. */
export abstract class EvaluationRetentionFloorPort {
  abstract getFloorMs(input: { table: "evaluation_runs"; tenantId: string }): Promise<number>;
}

export type EvaluationClickHouseResult = {
  json<T>(): Promise<T[]>;
};

export type EvaluationClickHouseInsert = {
  table: string;
  values: Record<string, unknown>[];
  format: "JSONEachRow";
  clickhouse_settings?: ClickHouseSettings;
};

export type EvaluationClickHouseQuery = {
  query: string;
  query_params: Record<string, unknown>;
  format: "JSONEachRow";
  clickhouse_settings?: ClickHouseSettings;
};

export type EvaluationClickHouseClient = {
  insert(input: EvaluationClickHouseInsert): Promise<unknown>;
  query(input: EvaluationClickHouseQuery): Promise<EvaluationClickHouseResult>;
};

export type EvaluationClickHouseResolver = (
  tenantId: string,
) => Promise<EvaluationClickHouseClient>;
