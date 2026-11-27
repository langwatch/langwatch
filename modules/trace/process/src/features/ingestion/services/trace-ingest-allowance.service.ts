/**
 * The plan's monthly allowance both ingestion doors ask before a batch is ingested. Entitlement
 * decides; this service keeps main's door rule that a reading which fails admits the batch.
 * Spec: specs/server/api-process-plan-allowance.feature
 */
import { isUpgradeInProgress } from "@langwatch/api";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { HandledError, isHandledTransientRefusal } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { TracePlanLimitRefusalsRepository } from "../repositories/trace-plan-limit-refusals.repository.ts";

/** Main's `PlanLimitExceededError` code, the one refusal a door lets through to the caller. */
const PLAN_LIMIT_CODE = "ERR_PLAN_LIMIT";

const DAY_MS = 24 * 60 * 60 * 1000;

type TraceIngestAllowanceOptions = Readonly<{
  entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
  /** Where each plan-limit refusal is counted; absent, refusals are only logged. */
  refusals?: Pick<TracePlanLimitRefusalsRepository, "recordRefusal"> | undefined;
  logger?: Pick<Logger, "error" | "warn" | "info"> | undefined;
  now?: (() => number) | undefined;
}>;

/** Whether an ingest door's allowance refused the batch with the plan limit. */
function isPlanLimitRefusal(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.code === PLAN_LIMIT_CODE;
}

export class TraceIngestAllowanceService {
  static create({
    entitlement,
    refusals,
    logger,
    now,
  }: TraceIngestAllowanceOptions): TraceIngestAllowanceService {
    return new TraceIngestAllowanceService({
      entitlement,
      refusals,
      logger: logger ?? createLogger("langwatch:trace:ingest-allowance"),
      now: now ?? (() => nowInstant().epochMilliseconds),
    });
  }

  private readonly entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
  private readonly refusals: Pick<TracePlanLimitRefusalsRepository, "recordRefusal"> | undefined;
  private readonly logger: Pick<Logger, "error" | "warn" | "info">;
  private readonly now: () => number;

  private constructor(options: {
    entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
    refusals: Pick<TracePlanLimitRefusalsRepository, "recordRefusal"> | undefined;
    logger: Pick<Logger, "error" | "warn" | "info">;
    now: () => number;
  }) {
    this.entitlement = options.entitlement;
    this.refusals = options.refusals;
    this.logger = options.logger;
    this.now = options.now;
  }

  /** Throws the plan limit; any other failure is logged and the batch admitted, as main. */
  async assertWithinAllowance({
    projectId,
    organizationId,
    customerTraceIds = [],
  }: {
    projectId: string;
    organizationId: string;
    customerTraceIds?: string[];
  }): Promise<void> {
    try {
      await this.entitlement.assertWithinUsageLimit({ organizationId });
    } catch (error) {
      if (!isPlanLimitRefusal(error)) {
        this.logger[isExpectedRefusal(error) ? "warn" : "error"](
          { error, projectId, customerTraceIds },
          "Error checking trace limit",
        );
        return;
      }
      this.logger.info(
        { projectId, customerTraceIds, ...error.meta },
        "Project has reached plan limit",
      );
      await this.#countRefusal(projectId);
      throw error;
    }
  }

  /** One increment per refused request; a failed write is logged and the refusal stands as is. */
  async #countRefusal(projectId: string): Promise<void> {
    if (this.refusals === undefined) return;
    const dayStartMs = Math.floor(this.now() / DAY_MS) * DAY_MS;
    try {
      await this.refusals.recordRefusal({ projectId, dayStartMs });
    } catch (error) {
      this.logger.warn({ error, projectId }, "Failed to count a plan-limit refusal");
    }
  }
}

/** An upgrade in progress or a busy or unreachable ClickHouse: retryable, so it warns. */
function isExpectedRefusal(error: unknown): boolean {
  return isUpgradeInProgress(error) || isHandledTransientRefusal(error);
}
