// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Databricks AI/BI Genie puller — the first adapter whose records exist for
 * VISIBILITY rather than for money (ADR-088 Decisions 1, 2 and 5).
 *
 * Genie is a natural-language analytics surface: a user asks a question, Genie
 * writes SQL against Unity Catalog and runs it. For governance that is the
 * whole point — the question and the generated SQL are the sensitive artefacts,
 * and until now they were invisible to the platform. Every other pulled source
 * answers "what did this cost"; this one answers "who asked what, and what SQL
 * did it run against our warehouse".
 *
 * It cannot be an `HttpPollingPullerAdapter` config. That adapter maps one flat
 * paginated feed through JSON paths, and Genie is a THREE-level walk —
 * spaces → conversations → messages — with a separate SCIM call to turn the
 * numeric author id into a person. A declarative field mapping has nowhere to
 * put a join.
 *
 * Three things about the upstream API that are load-bearing. The live evidence
 * tier at the bottom of the integration suite is what settles them against a
 * real workspace; it is skipped without a credential, so where a claim below
 * rests on the docs alone it says so:
 *
 *   `include_all=true` is NOT optional. Without it the conversations endpoint
 *   returns only the CALLER'S OWN conversations. A governance puller that
 *   omitted it would run green forever and report one user's activity as if it
 *   were the workspace's — the worst possible failure for this feature, because
 *   nothing anywhere would look wrong.
 *
 *   Cost is absent, and its absence is the design. Genie charges nothing per
 *   message; the SQL warehouse DBUs a question burns are billed through
 *   Databricks' own system tables, which this API does not expose. So the
 *   record carries zero — `provider_reported` because it is the provider's
 *   position and not a figure we derived, `estimate` because zero is honestly
 *   an approximation of what the warehouse actually charged. Claiming `exact`
 *   would assert we hold the invoice for a question we can only see half of.
 *
 *   A message is NOT immutable while it is being answered. Databricks fills
 *   `attachments` progressively, so a message read at `IN_PROGRESS` or
 *   `EXECUTING_QUERY` can carry the question without the generated SQL. The
 *   record is keyed on the message id and both sinks replace on it, so a later
 *   read overwrites rather than duplicating — but only if a later read happens,
 *   which is why the watermark stops just short of the oldest message that
 *   could still change (`isSettling`, `nextWatermark`) rather than moving to
 *   the sweep's start. Stopping altogether would be the easy version and the
 *   wrong one: a busy workspace always has something mid-answer, so the window
 *   would never advance at all.
 *
 *   The dimensions are the coordinates of the message itself and nothing about
 *   the author, so an identity that resolves differently on a later pull (a
 *   backfilled SCIM `externalId`, a renamed account) re-labels the record
 *   instead of minting a second one.
 */
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type {
  DatabricksGeniePullConfig,
  GovernancePuller as PullerAdapter,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { GovernanceHttpClient } from "../../../channels/governance-http.channel.ts";
import {
  configuredSinceMs,
  cursorSchema,
  encodeGenieCursor,
  type GenieCursor,
  nextCursor,
} from "../rules/databricks-genie-cursor.rules.ts";
import type { PaidGenieBillOutcome } from "../rules/databricks-genie-paid-bill.rules.ts";
import type { SweepResult } from "../rules/databricks-genie-sweep.rules.ts";
import { withWarehouseCost } from "../rules/databricks-genie-warehouse-cost.rules.ts";
import type { WarehousePricedStatement } from "../rules/warehouse-cost.rules.ts";
import { DatabricksGenieConversationService } from "./databricks-genie-conversation.service.ts";
import { DatabricksGenieCostWalkService } from "./databricks-genie-cost-walk.service.ts";
import { DatabricksGeniePaidBillService } from "./databricks-genie-paid-bill.service.ts";
import {
  DatabricksGenieRunBudgetService,
  MAX_REQUESTS_PER_RUN,
} from "./databricks-genie-run-budget.service.ts";
import { DatabricksGenieStatementService } from "./databricks-genie-statement.service.ts";
import { DatabricksGenieSweepService } from "./databricks-genie-sweep.service.ts";
import { DatabricksGenieWorkspaceService } from "./databricks-genie-workspace.service.ts";
import { DatabricksWarehouseCostService } from "./puller-databricks-warehouse-cost.service.ts";

export { WAREHOUSE_COST_ROW_LIMIT } from "../rules/databricks-genie-warehouse-cost.rules.ts";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

/**
 * The run held its place because the warehouse bill could not be read, and
 * said so in its result.
 *
 * A code rather than a sentence, on `PER_KEY_ATTRIBUTION_UNAVAILABLE`'s
 * precedent, so that it can survive a trip through storage once something
 * stores it. Today nothing does: the run returns it in `notices`, the tests
 * assert on it, and the worker that runs the adapter drops `notices` on the
 * floor — no screen and no person sees this code yet. The questions are still
 * recorded, unpriced, and the period is asked about again next run; the log
 * line beside it is where a reader finds out that the figure they are not
 * seeing is being waited for, not that it is zero.
 */
export const WAREHOUSE_COST_UNREADABLE = "warehouse_cost_unreadable" as const;

/**
 * The paid Genie bill line could not be read this run, and the run said so
 * in its result.
 *
 * Same shape and same standing as `WAREHOUSE_COST_UNREADABLE`, for the other
 * read: the bill was refused, the statement failed, or the source has the read
 * switched on with no warehouse to run it on. Returned in `notices`, asserted
 * by the tests, and read by nothing downstream yet. The read holds its own
 * place and asks again next run, for as long as `WAREHOUSE_COST_MAX_HOLD_MS`
 * allows.
 */
export const PAID_GENIE_BILL_UNREADABLE = "paid_genie_bill_unreadable" as const;

export class DatabricksGeniePullerService implements PullerAdapter<DatabricksGeniePullConfig> {
  readonly id: string = DATABRICKS_GENIE_ADAPTER_ID;

  /**
   * Requests one run may spend before handing the rest to the next.
   *
   * Production takes `MAX_REQUESTS_PER_RUN`. Tests lower it so "the budget runs
   * out at the Nth request" is a counted fact rather than a race against
   * wall-clock — the only way to drive a resume path deterministically. It sits
   * here rather than on `PullRunOptions` because no other adapter honours it,
   * and a knob on the shared contract that five of six adapters ignore is a
   * promise the next adapter author would reasonably believe.
   */
  private readonly maxRequests: number;

  private readonly workspace: DatabricksGenieWorkspaceService;
  private readonly sweeps: DatabricksGenieSweepService;
  private readonly costs: DatabricksGenieCostWalkService;
  private readonly paidBills: DatabricksGeniePaidBillService;

  private constructor(
    http: GovernanceHttpClient,
    private readonly warehouseCosts: DatabricksWarehouseCostService,
    options?: { maxRequests?: number },
  ) {
    this.maxRequests = Math.max(1, options?.maxRequests ?? MAX_REQUESTS_PER_RUN);
    this.workspace = DatabricksGenieWorkspaceService.create(http);
    const statements = DatabricksGenieStatementService.create({
      workspace: this.workspace,
      warehouseCosts,
    });
    this.sweeps = DatabricksGenieSweepService.create({
      workspace: this.workspace,
      conversations: DatabricksGenieConversationService.create(this.workspace),
      warehouseCosts,
    });
    this.costs = DatabricksGenieCostWalkService.create({ statements, warehouseCosts });
    this.paidBills = DatabricksGeniePaidBillService.create({ statements, warehouseCosts });
  }

  static create(
    http: GovernanceHttpClient,
    options?: { maxRequests?: number },
    warehouseCosts: DatabricksWarehouseCostService = DatabricksWarehouseCostService.create(),
  ): DatabricksGeniePullerService {
    return new DatabricksGeniePullerService(http, warehouseCosts, options);
  }

  validateConfig(config: unknown): DatabricksGeniePullConfig {
    return databricksGeniePullConfigSchema.parse(config);
  }

  async runOnce(options: PullRunOptions, config: DatabricksGeniePullConfig): Promise<PullResult> {
    const token = await this.workspace.resolveWorkspaceToken({
      credentials: options.credentials,
      workspaceUrl: config.workspaceUrl,
      signal: options.signal,
    });

    const cursor = DatabricksGeniePullerService.parseCursor(options.cursor, config);
    const budget = DatabricksGenieRunBudgetService.create({
      deadlineMs: options.deadlineMs,
      maxRequests: this.maxRequests,
    });
    // Stamped BEFORE the first request when a FRESH sweep begins, and carried
    // unchanged through every run that resumes it. The next watermark is
    // derived from this instant, so anything created while the sweep is
    // running lands after it and is caught next time.
    //
    // Resuming is the case that matters: `spaceId` means a sweep is already in
    // flight, and re-stamping here would anchor the finished sweep to its LAST
    // run instead of its first, silently dropping everything asked in an
    // already-swept space in between. Reading the clock at the end of the run
    // would be the same bug, one step worse.
    const resuming = cursor.spaceId !== null && cursor.sweepStartedAtMs !== null;
    const sweepStartedAtMs = resuming ? cursor.sweepStartedAtMs! : nowInstant().epochMilliseconds;

    let sweep: SweepResult;
    try {
      sweep = await this.sweeps.sweep({ config, token, options, budget, cursor });
    } catch (error) {
      // Only a failure to enumerate spaces reaches here — everything below it
      // is isolated. With no space list there is nothing to have read, so the
      // cursor stays put and the run is reported as failed.
      logger.error(
        {
          adapter: this.id,
          workspaceUrl: config.workspaceUrl,
          error: error instanceof Error ? error.message : String(error),
        },
        "databricks genie could not enumerate spaces; leaving the cursor where it was",
      );
      return { events: [], cursor: options.cursor, errorCount: 1 };
    }

    // After the sweep, not during it: the billing read covers the whole run at
    // once, and the window it asks about is the window the sweep actually read.
    // Asking first would either guess that window or ask per space. It is one
    // read of that window, taken a day at a time — see `warehouseCost`.
    const { costByStatementId, pricedThroughMs, unreadable } = await this.costs.warehouseCost({
      config,
      token,
      options,
      budget,
      fromMs: this.warehouseCosts.costReadFloor({
        sinceMs: cursor.sinceMs,
        nowMs: sweepStartedAtMs,
        costEnabled: config.warehouseId !== undefined,
      }),
      toMs: nowInstant().epochMilliseconds,
    });

    // The second, independent read: the paid Genie bill line, on its own
    // position. Only when the source switched it on; a source that did not
    // never posts the statement and its cursor field stays null.
    const paidBill: PaidGenieBillOutcome = config.readPaidGenieBill
      ? await this.paidBills.paidGenieBill({ config, token, options, budget, cursor })
      : { events: [], window: null, unreadable: false };

    return DatabricksGeniePullerService.runResult({
      config,
      cursor,
      sweep,
      sweepStartedAtMs,
      costByStatementId,
      pricedThroughMs,
      unreadable,
      paidBill,
    });
  }

  /** The run's events with their warehouse cost attached, the cursor for the next run, and its notices. */
  private static runResult({
    config,
    cursor,
    sweep,
    sweepStartedAtMs,
    costByStatementId,
    pricedThroughMs,
    unreadable,
    paidBill,
  }: {
    config: DatabricksGeniePullConfig;
    cursor: GenieCursor;
    sweep: SweepResult;
    sweepStartedAtMs: number;
    costByStatementId: Map<string, WarehousePricedStatement> | null;
    pricedThroughMs: number | null;
    unreadable: boolean;
    paidBill: PaidGenieBillOutcome;
  }): PullResult {
    return {
      events: [
        ...withWarehouseCost({
          events: sweep.events,
          costByStatementId,
          costEnabled: config.warehouseId !== undefined,
          watermarkMs: cursor.sinceMs,
        }),
        ...paidBill.events,
      ],
      cursor: encodeGenieCursor(
        // The cost read is part of what this run knows, so the watermark answers
        // to it as well as to the sweep. Without that, a window whose bill could
        // not be read is still recorded, still advanced past, and never revisited.
        nextCursor({
          previous: cursor,
          sweep,
          sweepStartedAtMs,
          pricedThroughMs,
          paidBillWindow: paidBill.window,
          nowMs: nowInstant().epochMilliseconds,
        }),
      ),
      errorCount: 0,
      ...DatabricksGeniePullerService.runNotices({
        unreadable,
        paidBillUnreadable: paidBill.unreadable,
      }),
    };
  }

  /**
   * The cursor's one invariant, enforced in the single place that mints one:
   * `conversationId` requires `spaceId`, and `spaceId` requires
   * `sweepStartedAtMs`.
   *
   * A resume point without the anchor it belongs to is worse than no resume
   * point. `runOnce` only treats a cursor as resuming when BOTH `spaceId` and
   * `sweepStartedAtMs` are set, so a cursor carrying a position but no anchor
   * would stamp a fresh anchor at now, still skip every space before the
   * position, complete, and then set the watermark from that fresh anchor —
   * losing everything it skipped. Cursors written before the anchor existed have
   * exactly that shape, so this is reachable rather than theoretical.
   */
  private static withoutOrphanedResume(cursor: GenieCursor): GenieCursor {
    if (cursor.sweepStartedAtMs !== null && cursor.spaceId !== null) {
      return cursor;
    }
    if (cursor.spaceId === null && cursor.conversationId === null) return cursor;
    logger.warn(
      { cursor },
      "databricks genie cursor carries a resume position with no sweep anchor; restarting the sweep from the top",
    );
    return {
      ...cursor,
      spaceId: null,
      conversationId: null,
      sweepHadGap: false,
      spaceSetFingerprint: null,
      // Safe to drop with the sweep it belonged to: `sinceMs` is untouched, so
      // the unsettled message is still inside the window the restart will read,
      // and the restarted sweep derives its own ceiling from it.
      sweepOldestPendingMs: null,
    };
  }

  private static parseCursor(
    cursor: string | null,
    config: DatabricksGeniePullConfig,
  ): GenieCursor {
    if (cursor) {
      try {
        return DatabricksGeniePullerService.withoutOrphanedResume(
          cursorSchema.parse(JSON.parse(cursor)),
        );
      } catch {
        logger.warn(
          { cursor },
          "unreadable databricks genie cursor; restarting from the configured watermark",
        );
      }
    }
    return {
      sinceMs: configuredSinceMs({ config, nowMs: nowInstant().epochMilliseconds }),
      spaceId: null,
      conversationId: null,
      sweepHadGap: false,
      spaceSetFingerprint: null,
      sweepOldestPendingMs: null,
      sweepStartedAtMs: null,
      costHeldSinceMs: null,
      paidBillReadThroughMs: null,
      paidBillHeldSinceMs: null,
    };
  }

  /**
   * The notices field, or nothing at all.
   *
   * Absent rather than empty on a clean run, on `openaiAdmin.puller.ts`'s
   * precedent: a reader never has to tell an adapter that reported no notices
   * from one that reports none because it does not know how.
   */
  private static runNotices({
    unreadable,
    paidBillUnreadable,
  }: {
    unreadable: boolean;
    paidBillUnreadable: boolean;
  }): { notices?: string[] } {
    const notices = [
      ...(unreadable ? [WAREHOUSE_COST_UNREADABLE] : []),
      ...(paidBillUnreadable ? [PAID_GENIE_BILL_UNREADABLE] : []),
    ];
    return notices.length > 0 ? { notices } : {};
  }
}
