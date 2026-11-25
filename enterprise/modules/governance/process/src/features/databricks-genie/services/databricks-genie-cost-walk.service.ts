// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie puller's warehouse cost walk: the window a chunk at a time, held at the first period it cannot price. */

import { DATABRICKS_GENIE_ADAPTER_ID } from "@langwatch/enterprise-governance-contract";
import type {
  DatabricksGeniePullConfig,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import {
  WAREHOUSE_COST_TIMEOUT_MS,
  type WarehouseCostChunkOutcome,
  type WarehouseCostRead,
  unpricedFloor,
} from "../rules/databricks-genie-warehouse-cost.rules.ts";
import type { WarehousePricedStatement } from "../rules/warehouse-cost.rules.ts";
import type { DatabricksGenieRunBudgetService } from "./databricks-genie-run-budget.service.ts";
import type { DatabricksGenieStatementService } from "./databricks-genie-statement.service.ts";
import type { DatabricksWarehouseCostService } from "./puller-databricks-warehouse-cost.service.ts";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

export class DatabricksGenieCostWalkService {
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
  }): DatabricksGenieCostWalkService {
    return new DatabricksGenieCostWalkService(statements, warehouseCosts);
  }

  /**
   * What each Genie statement in the window cost, and how much of that window
   * the answer actually covers.
   *
   * Never throws, in any failure mode. This runs alongside a sweep whose job is
   * to record what people asked of the data, and that job does not depend on
   * this one: a workspace that has not granted the billing tables, or whose
   * metastore is briefly unavailable, should still get its activity. The
   * alternative trades the thing that always works for the thing that sometimes
   * does.
   *
   * The window is read a chunk at a time, oldest first, and the walk stops at
   * the first period it cannot price. `pricedThroughMs` is where it stopped,
   * and the caller keeps the watermark at or below it so that period is asked
   * about again next run instead of being written off. A first sweep spans
   * thirty days, and without that the whole month would be recorded at zero the
   * one time a busy warehouse tripped the row cap — permanently, because later
   * runs only re-read the settling window and would never look at those days
   * again.
   *
   * A chunk that cannot be answered whole is re-asked in days before the walk
   * gives up on it. Only a chunk that is REFUSED — the question reached billing
   * and billing said no — skips that, since asking the same question about less
   * gets the same no. A refusal still holds the watermark, exactly as an
   * answer cut short does: the questions in that period are recorded without
   * an amount, and moving past them would turn "not yet priced" into a figure
   * nothing later corrects. A credential that is refused forever is what the
   * hold's expiry (`WAREHOUSE_COST_MAX_HOLD_MS`) is for — the source moves on
   * after it, and the questions it leaves behind stay unpriced rather than
   * zero.
   *
   * `null` means no ceiling is owed: the whole window priced.
   */
  async warehouseCost({
    config,
    token,
    options,
    budget,
    fromMs,
    toMs,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    fromMs: number;
    toMs: number;
  }): Promise<{
    costByStatementId: Map<string, WarehousePricedStatement> | null;
    /** The instant past which cost is not known. `null` owes no ceiling. */
    pricedThroughMs: number | null;
    /**
     * Whether the hold above is for a bill that was REFUSED rather than merely
     * late or large — the case a reader of the source has to be told about,
     * because waiting will not fix it on its own.
     */
    unreadable: boolean;
  }> {
    const warehouseId = config.warehouseId;
    if (!warehouseId) {
      return {
        costByStatementId: null,
        pricedThroughMs: null,
        unreadable: false,
      };
    }

    const costByStatementId = new Map<string, WarehousePricedStatement>();

    for (const chunk of this.warehouseCosts.chunks({ fromMs, toMs })) {
      const outcome = await this.priceWarehouseCostChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk,
        costByStatementId,
      });
      if (outcome.done) {
        return {
          costByStatementId,
          pricedThroughMs: outcome.pricedThroughMs,
          unreadable: outcome.unreadable,
        };
      }
    }

    return { costByStatementId, pricedThroughMs: null, unreadable: false };
  }

  /**
   * One chunk of the sweep: whether the run still has room for it, the answer,
   * and — when the answer is not whole — the pieces. `done` stops the walk with
   * a ceiling; `!done` carries it to the next chunk.
   */
  private async priceWarehouseCostChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
    costByStatementId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): Promise<WarehouseCostChunkOutcome> {
    // Out of requests, or out of the time one more would need, with days still
    // unpriced. Those days are not refused, just unread, so the watermark holds
    // here and the next run starts its cost read where this one ran out — which
    // is what turns a month-long backfill into several runs that each progress.
    //
    // The time half has to be asked BEFORE the request, against the whole of
    // `WAREHOUSE_COST_TIMEOUT_MS`. A billing read still in flight when the
    // worker's deadline lands does not merely go unpriced: the worker kills the
    // run and discards the questions the sweep had already read, and the cursor
    // stays where it was, so the next run reads them and stalls in the same
    // place. Unpriced questions are recoverable; a run killed holding them is
    // the sweep done for nothing.
    if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
      return this.noRoomLeft({ warehouseId, chunk });
    }

    const read = await this.statements.warehouseCostChunk({
      config,
      token,
      options,
      budget,
      warehouseId,
      chunk,
    });

    // The question itself was answered, and the answer was no. Asking about
    // less would be answered no the same way, so the pieces are not tried —
    // but the period is HELD, not written off. The questions in it are
    // recorded without an amount, and the watermark stops here so they are
    // asked about again: a warehouse that was deleted, a grant that was
    // revoked, or a token that lost its scope can all be put right, and the
    // day the bill answers is the day those questions get their figure.
    // Moving on instead would leave them unpriced forever with nothing
    // reporting it. `WAREHOUSE_COST_MAX_HOLD_MS` is what stops a refusal that
    // is never put right from pinning the source.
    if (read.outcome === "failed") {
      logger.error(
        {
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          warehouseId,
          pricedThrough: Temporal.Instant.fromEpochMilliseconds(chunk.fromMs).toString(),
        },
        "databricks warehouse cost could not be read; holding the watermark so the period is asked about again",
      );
      return {
        done: true,
        pricedThroughMs: unpricedFloor(chunk),
        unreadable: true,
      };
    }

    if (read.outcome === "priced") {
      return this.pricedChunk({ chunk, read, costByStatementId });
    }

    // Either more rows exist here than one reply can carry, or the answer did
    // not come back in time. Both are reasons to ask about LESS rather than to
    // give up on the period: surrendering the whole chunk costs every question
    // inside it its cost figure, including the days that would have answered on
    // their own.
    return this.warehouseCostChunkInPieces({
      config,
      token,
      options,
      budget,
      warehouseId,
      chunk,
      read,
      costByStatementId,
    });
  }

  /** Out of room before the next question: the walk stops and the watermark holds at this chunk. */
  private noRoomLeft({
    warehouseId,
    chunk,
  }: {
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
  }): WarehouseCostChunkOutcome {
    logger.warn(
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        warehouseId,
        pricedThrough: Temporal.Instant.fromEpochMilliseconds(chunk.fromMs).toString({
          fractionalSecondDigits: 3,
        }),
      },
      "databricks warehouse cost has no room left in this run; holding the watermark at the last priced day",
    );
    return {
      done: true,
      pricedThroughMs: unpricedFloor(chunk),
      unreadable: false,
    };
  }

  /** A chunk that priced: its cost merged, and the walk held here while a statement still owes a bill. */
  private pricedChunk({
    chunk,
    read,
    costByStatementId,
  }: {
    chunk: { fromMs: number; toMs: number };
    read: Extract<WarehouseCostRead, { outcome: "priced" }>;
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): WarehouseCostChunkOutcome {
    // A statement is emitted for every chunk it burned compute in, carrying
    // that chunk's hours only, so a statement running across a boundary
    // arrives here twice with a different part of itself. `DatabricksWarehouseCostService.merge`
    // adds rather than replaces for exactly that reason — see the ownership
    // note on the hour clip in `WAREHOUSE_COST_STATEMENT`.
    this.warehouseCosts.merge({
      into: costByStatementId,
      from: read.costByStatementId,
    });
    // Priced, but not wholly: a statement here was seen and has no bill yet.
    // Hold the watermark at the chunk's start so the whole chunk is re-read
    // once billing lands, rather than moving past the unbilled statement and
    // recording it at zero for good. The statements that did price keep the
    // cost merged above; a re-read simply replaces their ledger rows with the
    // same figure. The hold is bounded by `WAREHOUSE_COST_MAX_HOLD_MS`, so a
    // statement that is never billed stops holding the source after that.
    if (read.owed) {
      return {
        done: true,
        pricedThroughMs: unpricedFloor(chunk),
        unreadable: false,
      };
    }
    return { done: false };
  }

  /**
   * A chunk that could not be priced whole, re-asked in smaller pieces. Every
   * piece that answers is priced into the shared map; the walk stops at the
   * first that does not.
   *
   * Paid for only once a chunk has actually been refused, so a workspace whose
   * chunks answer never spends a request here. `done` tells the walk whether to
   * stop with a ceiling — some piece was refused, or the run ran out of room —
   * or carry on to the next chunk because every piece priced. When a piece is
   * refused the ceiling holds at that piece, not at the start of the chunk it
   * was in: the pieces answered before it keep their cost and are never asked
   * about again.
   */
  private async warehouseCostChunkInPieces({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
    read,
    costByStatementId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
    read: WarehouseCostRead;
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): Promise<WarehouseCostChunkOutcome> {
    const pieces = this.warehouseCosts.pieces(chunk);
    logger.warn(
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        warehouseId,
        outcome: read.outcome,
        chunkFrom: Temporal.Instant.fromEpochMilliseconds(chunk.fromMs).toString({
          fractionalSecondDigits: 3,
        }),
        chunkTo: Temporal.Instant.fromEpochMilliseconds(chunk.toMs).toString({
          fractionalSecondDigits: 3,
        }),
        pieces: pieces.length,
      },
      "databricks warehouse cost could not price a period whole; asking about smaller pieces of it",
    );

    const walked =
      pieces.length === 0
        ? { heldAt: chunk, unreadable: false }
        : await this.walkWarehouseCostPieces({
            config,
            token,
            options,
            budget,
            warehouseId,
            pieces,
            costByStatementId,
          });

    if (walked.heldAt) {
      logger.error(
        {
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          warehouseId,
          pricedThrough: Temporal.Instant.fromEpochMilliseconds(walked.heldAt.fromMs).toString(),
          refusedTo: Temporal.Instant.fromEpochMilliseconds(walked.heldAt.toMs).toString(),
          unreadable: walked.unreadable,
        },
        "databricks warehouse cost could not price a period even in pieces; holding the watermark so it is asked again",
      );
      return {
        done: true,
        pricedThroughMs: unpricedFloor(walked.heldAt),
        unreadable: walked.unreadable,
      };
    }

    return { done: false };
  }

  /**
   * The pieces in order: every piece that prices is merged — even one still
   * owing a bill keeps its billed hours' worth — and the first that stops the
   * walk (refused, owing, cut short, or outrunning the run's budget) is
   * returned as where the watermark holds. A refusal to a piece is still a
   * refusal to the question, and it is the same one whichever size it was
   * asked at: it holds at that piece like every other stop, and is flagged
   * `unreadable` so the run can say so. `heldAt: null` says every piece
   * priced whole.
   */
  private async walkWarehouseCostPieces({
    config,
    token,
    options,
    budget,
    warehouseId,
    pieces,
    costByStatementId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    warehouseId: string;
    pieces: { fromMs: number; toMs: number }[];
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): Promise<{
    heldAt: { fromMs: number; toMs: number } | null;
    unreadable: boolean;
  }> {
    for (const piece of pieces) {
      if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
        return { heldAt: piece, unreadable: false };
      }

      const pieceRead = await this.statements.warehouseCostChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk: piece,
      });

      if (pieceRead.outcome === "failed") {
        return { heldAt: piece, unreadable: true };
      }
      if (pieceRead.outcome !== "priced") {
        return { heldAt: piece, unreadable: false };
      }
      // Merged BEFORE the owed check, the same order the full-chunk path
      // uses: a piece can be owed for one hour and priced for others, and the
      // priced shares belong to this run's records rather than to nothing. The
      // hold below re-reads the piece once billing settles, and that re-read
      // replaces the ledger rows with the same figure — so keeping the cost
      // now costs nothing later.
      this.warehouseCosts.merge({
        into: costByStatementId,
        from: pieceRead.costByStatementId,
      });
      // A statement in this piece has no bill yet. Hold at the piece, exactly
      // as a refusal to it would: the pieces before it kept their cost and are
      // never re-asked, and this one is re-read once its billing settles.
      if (pieceRead.owed) {
        return { heldAt: piece, unreadable: false };
      }
    }
    return { heldAt: null, unreadable: false };
  }
}
