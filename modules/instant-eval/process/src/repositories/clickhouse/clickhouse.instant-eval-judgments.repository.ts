import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  InstantEvalJudgment,
  InstantEvalJudgmentPage,
  InstantEvalJudgmentQuery,
  InstantEvalJudgmentRecord,
  InstantEvalJudgmentSampleQuery,
  InstantEvalJudgmentsRepository,
} from "../instant-eval-judgments.repository.ts";
import {
  encodeInstantEvalCursor,
  INSTANT_EVAL_JUDGMENTS_TABLE,
  judgmentsPageRead,
  judgmentsSampleRead,
  type JudgmentRow,
  toJudgment,
} from "./clickhouse.instant-eval-judgments.mapper.ts";
import { instantEvalJudgments as judgments } from "./clickhouse.instant-eval-judgments.table.ts";
import type { InstantEvalClickHouseResolver } from "./clickhouse.instant-eval-session.store.ts";

const totalRowsSchema = z.array(z.object({ Total: z.string() }));

const logger = createLogger("langwatch:instant-evals:judgments-repository");

export class ClickHouseInstantEvalJudgmentsRepository implements InstantEvalJudgmentsRepository {
  private constructor(private readonly resolveClient: InstantEvalClickHouseResolver) {}

  static create({
    resolveClient,
  }: {
    resolveClient: InstantEvalClickHouseResolver;
  }): ClickHouseInstantEvalJudgmentsRepository {
    return new ClickHouseInstantEvalJudgmentsRepository(resolveClient);
  }

  /** Per project, so each read routes to the tenant's server; FINAL, as the report always read. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<number> {
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const counted = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
          .from(judgments)
          .final()
          .select({ Total: fn.toString(fn.count()) });
        const statement = (
          since === undefined
            ? counted
            : counted.where(({ gte }) => gte(judgments.CreatedAt, since))
        ).build();
        const [row] = totalRowsSchema.parse((await client.read({ statement })).rows);
        return Number.parseInt(row?.Total ?? "0", 10);
      }),
    );
    return perProject.reduce((sum, total) => sum + total, 0);
  }

  async insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void> {
    const [first] = records;
    if (!first) return;

    // One tenant per call, checked rather than trusted: this value chooses
    // which ClickHouse the batch is written to, so a mixed batch would land
    // one project's judgements in another's.
    const tenantId = first.TenantId;
    const foreign = records.find((record) => record.TenantId !== tenantId);
    if (foreign) {
      throw new Error(
        `instant_eval_judgments batch mixes tenants (${tenantId} and ${foreign.TenantId}); refusing to write`,
      );
    }

    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: INSTANT_EVAL_JUDGMENTS_TABLE,
      values: records.map((record) => ({
        ...record,
        OccurredAt: atEpoch(record.OccurredAt),
        CreatedAt: atEpoch(record.CreatedAt),
        UpdatedAt: atEpoch(record.UpdatedAt),
      })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
    logger.debug(
      { tenantId, runId: first.RunId, count: records.length },
      "Instant Eval judgements written",
    );
  }

  async getPage(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage> {
    // An empty trace list matches nothing; the builder refuses an empty set rather than send it.
    if (query.traceIds?.length === 0) return { judgments: [] };
    const client = await this.resolveClient(query.projectId);
    const { rows } = await client.read<JudgmentRow>({ statement: judgmentsPageRead(query) });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      judgments: page.map(toJudgment),
      ...(rows.length > query.limit && last
        ? { nextCursor: encodeInstantEvalCursor(toJudgment(last)) }
        : {}),
    };
  }

  async findSample(query: InstantEvalJudgmentSampleQuery): Promise<readonly InstantEvalJudgment[]> {
    const client = await this.resolveClient(query.projectId);
    const { rows } = await client.read<JudgmentRow>({ statement: judgmentsSampleRead(query) });
    return rows.map(toJudgment);
  }
}

/** The driver formats dates, so the record's epoch millis become one here. */
function atEpoch(at: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(at));
}
