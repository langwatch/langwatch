// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie puller's SQL statements: one window asked of the warehouse, and its reply read or refused. */

import { DATABRICKS_GENIE_ADAPTER_ID } from "@langwatch/enterprise-governance-contract";
import type {
  DatabricksGeniePullConfig,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";

import {
  PAID_GENIE_BILL_COLUMNS,
  PAID_GENIE_BILL_STATEMENT,
  type PaidGenieBillRead,
  paidGenieBillParameters,
  paidGenieBillRows,
} from "../rules/databricks-genie-paid-bill.rules.ts";
import {
  WAREHOUSE_COST_COLUMNS,
  WAREHOUSE_COST_ROW_LIMIT,
  WAREHOUSE_COST_STATEMENT,
  WAREHOUSE_COST_UNFINISHED_STATES,
  type WarehouseCostRead,
  type WarehouseCostStatement,
  warehouseAnswerCutShort,
  warehouseCostObserved,
  warehouseCostParameters,
  warehouseCostResponseSchema,
  warehouseCostRows,
} from "../rules/databricks-genie-warehouse-cost.rules.ts";
import type { DatabricksGenieRunBudgetService } from "./databricks-genie-run-budget.service.ts";
import {
  type DatabricksGenieWorkspaceService,
  GenieHttpError,
} from "./databricks-genie-workspace.service.ts";
import type { DatabricksWarehouseCostService } from "./puller-databricks-warehouse-cost.service.ts";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

export class DatabricksGenieStatementService {
  private constructor(
    private readonly workspace: DatabricksGenieWorkspaceService,
    private readonly warehouseCosts: DatabricksWarehouseCostService,
  ) {}

  static create({
    workspace,
    warehouseCosts,
  }: {
    workspace: DatabricksGenieWorkspaceService;
    warehouseCosts: DatabricksWarehouseCostService;
  }): DatabricksGenieStatementService {
    return new DatabricksGenieStatementService(workspace, warehouseCosts);
  }

  /** One chunk of the window, priced or refused. */
  async warehouseCostChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
  }): Promise<WarehouseCostRead> {
    const askedAtMs = nowInstant().epochMilliseconds;
    const observed = warehouseCostObserved({
      adapter: DATABRICKS_GENIE_ADAPTER_ID,
      warehouseId,
      chunk,
    });

    try {
      const payload = await this.postWarehouseCost({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk,
      });

      const read = DatabricksGenieStatementService.readWarehouseCost({
        payload,
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        warehouseId,
        warehouseCosts: this.warehouseCosts,
      });
      logger.info(
        {
          ...observed,
          outcome: read.outcome,
          elapsedMs: nowInstant().epochMilliseconds - askedAtMs,
          statements: read.outcome === "priced" ? read.costByStatementId.size : 0,
          owed: read.outcome === "priced" ? read.owed : false,
        },
        "databricks warehouse cost question answered",
      );
      return read;
    } catch (error) {
      // The same split the statement states get, at the other door. A request
      // this end gave up on, or one the workspace could not serve right now,
      // says nothing about whether the window can ever be priced. Only an
      // answer that will be the same next run is a refusal: a token without
      // the grant, or a warehouse that no longer exists, is refused
      // identically until an admin puts it right. Both hold the window; the
      // difference is that a refusal skips the smaller pieces and is reported
      // to whoever reads the source, since waiting alone will not fix it.
      const unfinished =
        !(error instanceof GenieHttpError) || error.status === 429 || error.status >= 500;
      logger.warn(
        {
          ...observed,
          elapsedMs: nowInstant().epochMilliseconds - askedAtMs,
          error: error instanceof Error ? error.message : String(error),
        },
        unfinished
          ? "databricks warehouse cost could not be reached; holding the window so it is asked again"
          : "databricks warehouse cost was refused; the questions stay unpriced and the window is held",
      );
      return { outcome: unfinished ? "timed_out" : "failed" };
    }
  }

  /** The cost statement for one window, posted to the warehouse that runs it. */
  private postWarehouseCost({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
  }): Promise<unknown> {
    return this.workspace.post({
      config,
      token,
      options,
      budget,
      path: "/api/2.0/sql/statements",
      body: {
        warehouse_id: warehouseId,
        statement: WAREHOUSE_COST_STATEMENT,
        // One request, no polling. A query that cannot finish inside the
        // wait is cancelled, and the window it covered is held rather than
        // written off, so the next run asks about it again. Polling would
        // hold a run open on the slowest thing it does.
        //
        // Fifty seconds is the most the API accepts, and it is asked for
        // because the warehouse routinely needs more than the thirty this
        // used to allow. Measured against a real workspace on 2026-08-19,
        // five reads of a week each came back in 10.8s, 23.4s, 26.9s, 37.7s
        // and 22.0s — a thirty-second limit sits inside that spread and
        // cancels answers that were on their way.
        //
        // Still inside the client's own `WAREHOUSE_COST_TIMEOUT_MS`, which
        // stays the outer bound: the warehouse gives up before this end does,
        // so a cancelled statement is reported rather than merely abandoned.
        wait_timeout: "50s",
        on_wait_timeout: "CANCEL",
        format: "JSON_ARRAY",
        disposition: "INLINE",
        parameters: warehouseCostParameters(chunk),
      },
    });
  }

  /** One window of the bill line, read or refused. */
  async paidGenieBillChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
  }): Promise<PaidGenieBillRead> {
    const askedAtMs = nowInstant().epochMilliseconds;
    const observed = {
      adapter: DATABRICKS_GENIE_ADAPTER_ID,
      warehouseId,
      read: "genie_bill",
      askedFrom: Temporal.Instant.fromEpochMilliseconds(chunk.fromMs).toString(),
      askedTo: Temporal.Instant.fromEpochMilliseconds(chunk.toMs).toString(),
    };
    try {
      const payload = await this.workspace.post({
        config,
        token,
        options,
        budget,
        path: "/api/2.0/sql/statements",
        body: {
          warehouse_id: warehouseId,
          statement: PAID_GENIE_BILL_STATEMENT,
          // Same wait as the warehouse read, for the same measured reason.
          wait_timeout: "50s",
          on_wait_timeout: "CANCEL",
          format: "JSON_ARRAY",
          disposition: "INLINE",
          parameters: paidGenieBillParameters(chunk),
        },
      });
      const read = DatabricksGenieStatementService.readPaidGenieBill({
        payload,
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        warehouseId,
      });
      logger.info(
        {
          ...observed,
          outcome: read.outcome,
          elapsedMs: nowInstant().epochMilliseconds - askedAtMs,
          rows: read.outcome === "priced" ? read.rows.length : 0,
        },
        "databricks genie bill question answered",
      );
      return read;
    } catch (error) {
      // The same split as `warehouseCostChunk`: only an answer that will be
      // the same next run is a refusal.
      const unfinished =
        !(error instanceof GenieHttpError) || error.status === 429 || error.status >= 500;
      logger.warn(
        {
          ...observed,
          elapsedMs: nowInstant().epochMilliseconds - askedAtMs,
          error: error instanceof Error ? error.message : String(error),
        },
        unfinished
          ? "databricks genie bill could not be reached; holding the read so it is asked again"
          : "databricks genie bill was refused; holding the read so it is asked again",
      );
      return { outcome: unfinished ? "timed_out" : "failed" };
    }
  }

  /**
   * The window is unpriced and we know why. Whether it is worth asking about
   * again is decided entirely here, and every state that is not a success used to
   * answer no. A statement cancelled for running past its wait is the one this
   * gets wrong most often: the warehouse was answering it perfectly well and
   * simply ran out of the time the request allowed, so the same question asked
   * again — or asked about less — answers fine.
   */
  private static readUnsuccessfulWarehouseCost({
    statement,
    log,
  }: {
    statement: WarehouseCostStatement;
    log: Record<string, unknown>;
  }): WarehouseCostRead {
    const unfinished = WAREHOUSE_COST_UNFINISHED_STATES.has(statement.status.state);
    logger.warn(
      {
        ...log,
        state: statement.status.state,
        error: statement.status.error?.message,
      },
      unfinished
        ? "databricks warehouse cost query ran out of time; holding the window so it is asked again"
        : "databricks warehouse cost query did not succeed; recording the questions without cost",
    );
    return { outcome: unfinished ? "timed_out" : "failed" };
  }

  /**
   * Turn one cost reply into per-statement cost, or refuse the whole reply.
   *
   * A refusal prices nothing from this reply — the questions are still recorded,
   * and a re-read leaves any cost an earlier run worked out alone. Refusing whole
   * is deliberate: a partial answer prices some questions and leaves the rest at
   * nothing, and nothing is indistinguishable from a question that genuinely cost
   * nothing.
   */
  private static readWarehouseCost({
    payload,
    adapter,
    warehouseId,
    warehouseCosts,
  }: {
    payload: unknown;
    adapter: string;
    warehouseId: string;
    warehouseCosts: DatabricksWarehouseCostService;
  }): WarehouseCostRead {
    const statement = warehouseCostResponseSchema.parse(payload);
    // Named for what it is. This warehouse ran the billing query; it is not the
    // warehouse whose compute the reply is about, and a log line that conflates
    // the two sends whoever reads it to the wrong workspace object.
    const log = { adapter, executorWarehouseId: warehouseId };

    if (statement.status.state !== "SUCCEEDED") {
      return DatabricksGenieStatementService.readUnsuccessfulWarehouseCost({ statement, log });
    }

    // No manifest is a refusal, not a pass. The rows are positional and every
    // value in them is a string, so without the names there is nothing that could
    // tell a correct answer from a reordered one — which is the whole case this
    // check exists for. An answer we cannot check is one we cannot price from.
    const served = statement.manifest?.schema?.columns?.map((c) => c.name);
    if (!served || !WAREHOUSE_COST_COLUMNS.every((n, i) => served[i] === n)) {
      logger.error(
        { ...log, expected: WAREHOUSE_COST_COLUMNS, served },
        "databricks warehouse cost query answered with unexpected columns; refusing to price from it",
      );
      // Not `cut_short`: the answer arrived, it just could not be trusted. A
      // narrower window would be answered with the same columns.
      return { outcome: "failed" };
    }

    const data = statement.result?.data_array ?? [];

    if (warehouseAnswerCutShort({ statement, dataLength: data.length })) {
      logger.error(
        {
          ...log,
          rows: data.length,
          limit: WAREHOUSE_COST_ROW_LIMIT,
          totalRowCount: statement.manifest?.total_row_count,
          nextChunkIndex: statement.result?.next_chunk_index,
        },
        "databricks warehouse cost answer was cut short; refusing a partial answer",
      );
      return { outcome: "cut_short" };
    }

    const { rows, unreadable } = warehouseCostRows(data);

    // Every other refusal reaches the log through `skipped`. A row that would not
    // parse is the one case that would otherwise under-price in silence.
    if (unreadable > 0) {
      logger.warn(
        { ...log, unreadable, rows: data.length },
        "some databricks warehouse cost rows could not be read; those questions carry no cost",
      );
    }

    const { costByStatementId, skipped, owed } = warehouseCosts.allocate({
      rows,
    });
    if (skipped.length > 0) {
      logger.warn(
        {
          ...log,
          skipped: skipped.length,
          // The reasons, not the rows: a workspace priced in one currency
          // produces one reason repeated a thousand times.
          reasons: [...new Set(skipped.map((entry) => entry.reason))],
          skus: [...new Set(skipped.map((entry) => entry.skuName))],
        },
        "some databricks warehouse compute could not be priced; those questions carry no cost",
      );
    }
    if (owed.size > 0) {
      logger.info(
        { ...log, owed: owed.size },
        "some databricks questions were seen but not billed yet; holding the watermark until their cost settles",
      );
    }
    return { outcome: "priced", costByStatementId, owed: owed.size > 0 };
  }

  /**
   * Turn one bill reply into rows, or refuse the whole reply. Refusing whole is
   * the same rule the warehouse read follows: a partial answer lands some of a
   * period's rows and leaves the rest absent, and absent is indistinguishable
   * from nobody having used Genie that day.
   */
  private static readPaidGenieBill({
    payload,
    adapter,
    warehouseId,
  }: {
    payload: unknown;
    adapter: string;
    warehouseId: string;
  }): PaidGenieBillRead {
    const statement = warehouseCostResponseSchema.parse(payload);
    const log = { adapter, executorWarehouseId: warehouseId, read: "genie_bill" };

    if (statement.status.state !== "SUCCEEDED") {
      const unfinished = WAREHOUSE_COST_UNFINISHED_STATES.has(statement.status.state);
      logger.warn(
        {
          ...log,
          state: statement.status.state,
          error: statement.status.error?.message,
        },
        unfinished
          ? "databricks genie bill query ran out of time; holding the read so it is asked again"
          : "databricks genie bill query did not succeed; holding the read so it is asked again",
      );
      return { outcome: unfinished ? "timed_out" : "failed" };
    }

    const served = statement.manifest?.schema?.columns?.map((c) => c.name);
    if (!served || !PAID_GENIE_BILL_COLUMNS.every((n, i) => served[i] === n)) {
      logger.error(
        { ...log, expected: PAID_GENIE_BILL_COLUMNS, served },
        "databricks genie bill query answered with unexpected columns; refusing to read from it",
      );
      return { outcome: "failed" };
    }

    const data = statement.result?.data_array ?? [];
    if (warehouseAnswerCutShort({ statement, dataLength: data.length })) {
      logger.error(
        {
          ...log,
          rows: data.length,
          limit: WAREHOUSE_COST_ROW_LIMIT,
          totalRowCount: statement.manifest?.total_row_count,
          nextChunkIndex: statement.result?.next_chunk_index,
        },
        "databricks genie bill answer was cut short; refusing a partial answer",
      );
      return { outcome: "cut_short" };
    }

    const { rows, unreadable } = paidGenieBillRows(data);
    if (unreadable > 0) {
      logger.warn(
        { ...log, unreadable, rows: data.length },
        "some databricks genie bill rows could not be read; those rows are not recorded",
      );
    }
    return { outcome: "priced", rows };
  }
}
