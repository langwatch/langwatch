import type { Authorization } from "@langwatch/authorization";
import {
  AuthorizedClickHouse,
  type ClickHouseClientResolver,
  fillOwnerIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  type IdIndexFlags,
  type IdIndexOwnerFill,
  IdIndexReadiness,
  idIndexReadinessTargets,
} from "@langwatch/clickhouse-client";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";

import {
  EvaluationRunRepository,
  type EvaluationInputsRead,
  type EvaluationRunFloorLookup,
} from "../evaluation.repository.ts";
import type { EvaluationClickHouseResolver } from "./clickhouse.evaluation-session.store.ts";
import { EvaluationRunClickHouseReadRepository } from "./evaluation-run-read.repository.ts";
import { EvaluationRunClickHouseWriteRepository } from "./evaluation-run-write.repository.ts";

/**
 * The id indexes Evaluation fills (goose 00112; id-index plan §1). `evaluation_runs` expires on
 * `UpdatedAt`, not on its partition column `ScheduledAt`, so the index retains on `UpdatedAt`.
 */
export const EVALUATION_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "evaluation_runs",
    index: "evaluation_runs_id_index",
    key: ["EvaluationId"],
    time: "ScheduledAt",
    retentionAnchor: "UpdatedAt",
    retention: "copied",
  },
];

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
  readonly readiness: IdIndexReadiness;

  private constructor(
    private readonly options: {
      resolveClient: EvaluationClickHouseResolver;
      resolveQueryClient: ClickHouseClientResolver;
    },
  ) {
    super();
    this.reader = EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: options.resolveQueryClient }),
    });
    this.writer = EvaluationRunClickHouseWriteRepository.create({
      resolveClient: options.resolveClient,
    });
    // The routed client is one per process; the marker statements route by target themselves.
    const routed = () => options.resolveQueryClient("");
    this.readiness = IdIndexReadiness.create({
      statements: {
        query: async (request) => (await routed()).query(request),
        command: async (request) => (await routed()).command(request),
      },
      indexes: EVALUATION_ID_INDEXES,
      watch: async () =>
        idIndexReadinessTargets({ privateRoutes: (await routed()).privateRoutes() }),
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
    idIndex?: IdIndexFlags | undefined;
  }): Promise<EvaluationInputsRead | null> {
    return this.reader.findInputs(input);
  }

  async fillIdIndexes(input: IdIndexOwnerFill): Promise<IdIndexFillReport> {
    // The routed client is one per process and the fill visits every target itself.
    const clickhouse = await this.options.resolveQueryClient("");
    return fillOwnerIdIndexes({ ...input, clickhouse, indexes: EVALUATION_ID_INDEXES });
  }
}
