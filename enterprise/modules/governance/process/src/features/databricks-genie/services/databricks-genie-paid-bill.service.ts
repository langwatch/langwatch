// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie puller's paid bill read: its own window, a week at a time, held at the first piece it cannot read. */

import { DATABRICKS_GENIE_ADAPTER_ID } from "@langwatch/enterprise-governance-contract";
import type {
  DatabricksGeniePullConfig,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";

import { configuredSinceMs, type GenieCursor } from "../rules/databricks-genie-cursor.rules.ts";
import {
  ONE_DAY_MS,
  PAID_GENIE_BILL_SETTLING_LAG_MS,
  type PaidGenieBillOutcome,
  type PaidGenieBillRow,
  type PaidGenieBillStop,
  paidGenieBillEvent,
  startOfDayMs,
} from "../rules/databricks-genie-paid-bill.rules.ts";
import { WAREHOUSE_COST_TIMEOUT_MS } from "../rules/databricks-genie-warehouse-cost.rules.ts";
import type { DatabricksGenieRunBudgetService } from "./databricks-genie-run-budget.service.ts";
import type { DatabricksGenieStatementService } from "./databricks-genie-statement.service.ts";
import type { DatabricksWarehouseCostService } from "./puller-databricks-warehouse-cost.service.ts";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

export class DatabricksGeniePaidBillService {
  private constructor(
    private readonly statements: DatabricksGenieStatementService,
    private readonly warehouseCosts: DatabricksWarehouseCostService,
  ) {}

  static create({
    statements,
    warehouseCosts,
  }: {
    statements: DatabricksGenieStatementService;
    warehouseCosts: DatabricksWarehouseCostService;
  }): DatabricksGeniePaidBillService {
    return new DatabricksGeniePaidBillService(statements, warehouseCosts);
  }

  /**
   * The paid Genie bill line for the window this read owes, oldest first, a
   * week at a time, with a week that cannot be answered whole re-asked in days
   * — the same shape and the same helpers as `warehouseCost`, and the same hold
   * rule: cut short, timed out or refused, the walk stops and this read's own
   * position stays at the stopped piece, for as long as
   * `WAREHOUSE_COST_MAX_HOLD_MS` allows — `nextCursor` ages the hold and moves
   * the position to the window's end once it runs out. What is different is
   * what lands: every whole chunk or piece read before the stop lands its
   * rows; the answer that stopped short lands nothing, since which rows it
   * left out is exactly what it cannot say.
   *
   * Never throws, for the reason `warehouseCost` never does: the sweep's job
   * does not depend on this one.
   */
  async paidGenieBill({
    config,
    token,
    options,
    budget,
    cursor,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    cursor: GenieCursor;
  }): Promise<PaidGenieBillOutcome> {
    const warehouseId = config.warehouseId;
    if (!warehouseId) {
      // Switched on with nothing to run it on. The statement needs a warehouse
      // to execute; without one the read cannot start, and the source has to
      // be told rather than left quietly reading nothing. No window either:
      // nothing was asked, so there is no place to hold and no hold to age.
      logger.warn(
        { adapter: DATABRICKS_GENIE_ADAPTER_ID, workspaceUrl: config.workspaceUrl },
        "databricks genie bill read is switched on but the source names no warehouse to run it on",
      );
      return { events: [], window: null, unreadable: true };
    }

    // Day-aligned both ends: the bill is per day and the statement filters on
    // the date. Through the end of TODAY, so today's partial row lands and is
    // re-read next run — the settling lag on the way in is what re-reads it.
    const fromMs = startOfDayMs(
      cursor.paidBillReadThroughMs === null
        ? configuredSinceMs({ config, nowMs: nowInstant().epochMilliseconds })
        : cursor.paidBillReadThroughMs - PAID_GENIE_BILL_SETTLING_LAG_MS,
    );
    const toMs = startOfDayMs(nowInstant().epochMilliseconds) + ONE_DAY_MS;

    const rows: PaidGenieBillRow[] = [];
    for (const chunk of this.warehouseCosts.chunks({ fromMs, toMs })) {
      const stop = await this.walkPaidGenieBillChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk,
        rows,
      });
      if (stop !== null) {
        return this.paidGenieBillHeld({
          rows,
          heldAt: stop.heldAt,
          windowEndMs: toMs,
          unreadable: stop.unreadable,
        });
      }
    }

    return {
      events: rows.map(paidGenieBillEvent),
      window: { readThroughMs: toMs, endMs: toMs, held: false },
      unreadable: false,
    };
  }

  /**
   * One chunk of the bill window: whether the run still has room for it, the
   * answer, and — when the answer is not whole — the pieces. Rows land on
   * `rows` as they answer. Returns where the walk stopped, or null once the
   * whole chunk has landed, the same split `priceWarehouseCostChunk` makes.
   */
  private async walkPaidGenieBillChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
    rows,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
    rows: PaidGenieBillRow[];
  }): Promise<PaidGenieBillStop | null> {
    if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
      return { heldAt: chunk, unreadable: false };
    }
    const answer = await this.statements.paidGenieBillChunk({
      config,
      token,
      options,
      budget,
      warehouseId,
      chunk,
    });
    if (answer.outcome === "priced") {
      rows.push(...answer.rows);
      return null;
    }
    if (answer.outcome === "failed") {
      return { heldAt: chunk, unreadable: true };
    }

    // Cut short or timed out: ask about less before holding, exactly as the
    // warehouse read does, so the days that answer on their own still land.
    const pieces = this.warehouseCosts.pieces(chunk);
    if (pieces.length === 0) {
      return { heldAt: chunk, unreadable: false };
    }
    return this.walkPaidGenieBillPieces({
      config,
      token,
      options,
      budget,
      warehouseId,
      pieces,
      rows,
    });
  }

  /**
   * The pieces of a chunk that would not answer whole, in order. Every piece
   * that answers lands its rows; the first that does not stops the walk there,
   * so the days before it are never re-asked.
   */
  private async walkPaidGenieBillPieces({
    config,
    token,
    options,
    budget,
    warehouseId,
    pieces,
    rows,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    pieces: { fromMs: number; toMs: number }[];
    rows: PaidGenieBillRow[];
  }): Promise<PaidGenieBillStop | null> {
    for (const piece of pieces) {
      if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
        return { heldAt: piece, unreadable: false };
      }
      const answer = await this.statements.paidGenieBillChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk: piece,
      });
      if (answer.outcome === "priced") {
        rows.push(...answer.rows);
        continue;
      }
      return { heldAt: piece, unreadable: answer.outcome === "failed" };
    }
    return null;
  }

  /**
   * The walk stopped at `heldAt`. Everything read before it lands; the
   * position holds at the start of the stopped piece so it is asked about
   * again — whether or not anything landed. A read that stopped at its very
   * first chunk holds at the window's floor, and writing that floor down is
   * what keeps it: a first run's floor is "thirty days ago" unless the source
   * was told otherwise, so a hold that wrote nothing would start a day later
   * on every run and quietly lose the day before it each time.
   */
  private paidGenieBillHeld({
    rows,
    heldAt,
    windowEndMs,
    unreadable,
  }: {
    rows: PaidGenieBillRow[];
    heldAt: { fromMs: number; toMs: number };
    windowEndMs: number;
    unreadable: boolean;
  }): PaidGenieBillOutcome {
    logger.warn(
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        heldFrom: Temporal.Instant.fromEpochMilliseconds(heldAt.fromMs).toString(),
        heldTo: Temporal.Instant.fromEpochMilliseconds(heldAt.toMs).toString(),
        landed: rows.length,
        unreadable,
      },
      "databricks genie bill read stopped short; holding its place so the period is asked about again",
    );
    return {
      events: rows.map(paidGenieBillEvent),
      window: { readThroughMs: heldAt.fromMs, endMs: windowEndMs, held: true },
      unreadable,
    };
  }
}
