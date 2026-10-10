import type { Authorization } from "@langwatch/authorization";
import { AuthorizedClickHouse, type ClickHouseClientResolver } from "@langwatch/clickhouse-client";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";

import {
  EvaluationRunRepository,
  type EvaluationInputsRead,
  type EvaluationRunFloorLookup,
} from "../evaluation.repository.ts";
import type { EvaluationClickHouseResolver } from "./clickhouse.evaluation-session.store.ts";
import { EvaluationRunClickHouseReadRepository } from "./evaluation-run-read.repository.ts";
import { EvaluationRunClickHouseWriteRepository } from "./evaluation-run-write.repository.ts";

/** Composes the read and write adapters for the evaluation_runs table. */
export class ClickHouseEvaluationRepository extends EvaluationRunRepository {
  static create(options: {
    resolveClient: EvaluationClickHouseResolver;
    /** The client the proof-fenced reads resolve (ADR-177 block C). */
    resolveQueryClient: ClickHouseClientResolver;
  }): ClickHouseEvaluationRepository {
    return new ClickHouseEvaluationRepository(options);
  }

  private readonly reader: EvaluationRunClickHouseReadRepository;
  private readonly writer: EvaluationRunClickHouseWriteRepository;

  private constructor(options: {
    resolveClient: EvaluationClickHouseResolver;
    resolveQueryClient: ClickHouseClientResolver;
  }) {
    super();
    this.reader = EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: options.resolveQueryClient }),
    });
    this.writer = EvaluationRunClickHouseWriteRepository.create({
      resolveClient: options.resolveClient,
    });
  }

  upsert(input: {
    data: EvaluationRunData;
    tenantId: string;
    retentionDays?: number;
  }): Promise<void> {
    return this.writer.upsert(input);
  }

  upsertBatch(
    input: {
      data: EvaluationRunData;
      tenantId: string;
      retentionDays?: number;
    }[],
  ): Promise<void> {
    return this.writer.upsertBatch(input);
  }

  getByEvaluationId(input: EvaluationRunFloorLookup): Promise<EvaluationRunData> {
    return this.reader.getByEvaluationId(input);
  }

  findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    return this.reader.findByTraceId(input);
  }

  findInputs(input: {
    authorization: Authorization;
    evaluationId: string;
  }): Promise<EvaluationInputsRead | null> {
    return this.reader.findInputs(input);
  }
}
