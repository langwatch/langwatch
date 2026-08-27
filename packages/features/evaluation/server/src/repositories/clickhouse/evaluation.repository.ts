import type {
  EvaluationInputsQuery,
  EvaluationRunData,
  EvaluationRunLookup,
  EvaluationRunsByTraceQuery,
  EvaluationSummariesByTraceIdsQuery,
  EvaluationSummary,
  TraceEvaluationData,
  TraceEvaluationsQuery,
} from "@langwatch/evaluation-contract";
import type {
  EvaluationClickHouseResolver,
  EvaluationRetentionFloorPort,
} from "../../ports/evaluation.port";
import { EvaluationRunRepository } from "../evaluation.repository";
import { EvaluationRunClickHouseReadRepository } from "./evaluation-run-read.repository";
import { EvaluationRunClickHouseWriteRepository } from "./evaluation-run-write.repository";

/** Composes the read and write adapters for the evaluation_runs table. */
export class ClickHouseEvaluationRepository extends EvaluationRunRepository {
  static create(options: {
    resolveClient: EvaluationClickHouseResolver;
    retentionFloor: EvaluationRetentionFloorPort;
  }): ClickHouseEvaluationRepository {
    return new ClickHouseEvaluationRepository(options);
  }

  private readonly reader: EvaluationRunClickHouseReadRepository;
  private readonly writer: EvaluationRunClickHouseWriteRepository;

  private constructor(options: {
    resolveClient: EvaluationClickHouseResolver;
    retentionFloor: EvaluationRetentionFloorPort;
  }) {
    super();
    this.reader = EvaluationRunClickHouseReadRepository.create(options);
    this.writer = EvaluationRunClickHouseWriteRepository.create(options);
  }

  upsert(input: {
    data: EvaluationRunData;
    tenantId: string;
    retentionDays?: number;
  }): Promise<void> {
    return this.writer.upsert(input);
  }

  upsertBatch(
    input: Array<{
      data: EvaluationRunData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void> {
    return this.writer.upsertBatch(input);
  }

  tryFindByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null> {
    return this.reader.tryFindByEvaluationId(input);
  }

  findByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]> {
    return this.reader.findByTraceId(input);
  }

  findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>> {
    return this.reader.findSummariesByTraceIds(input);
  }

  findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>> {
    return this.reader.findTraceEvaluations(input);
  }

  tryFindInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null> {
    return this.reader.tryFindInputs(input);
  }
}
