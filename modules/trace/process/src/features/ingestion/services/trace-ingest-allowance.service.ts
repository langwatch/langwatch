/**
 * The plan's monthly allowance both ingestion doors ask before a batch is ingested. Entitlement
 * decides; this service keeps main's door rule that a reading which fails admits the batch.
 * Spec: specs/server/api-process-plan-allowance.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

/** Main's `PlanLimitExceededError` code, the one refusal a door lets through to the caller. */
const PLAN_LIMIT_CODE = "ERR_PLAN_LIMIT";

type TraceIngestAllowanceOptions = Readonly<{
  entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
  logger?: Pick<Logger, "error" | "warn" | "info"> | undefined;
}>;

/** Whether an ingest door's allowance refused the batch with the plan limit. */
function isPlanLimitRefusal(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.code === PLAN_LIMIT_CODE;
}

/** The schema is behind while an upgrade runs (P2021/P2022, or the 503 they become): expected. */
function isUpgradeBehind(error: unknown): boolean {
  if (HandledError.isHandled(error)) return error.code === "upgrade_in_progress";
  return (
    error instanceof Error && "code" in error && (error.code === "P2021" || error.code === "P2022")
  );
}

export class TraceIngestAllowanceService {
  static create({ entitlement, logger }: TraceIngestAllowanceOptions): TraceIngestAllowanceService {
    return new TraceIngestAllowanceService(
      entitlement,
      logger ?? createLogger("langwatch:trace:ingest-allowance"),
    );
  }

  private constructor(
    private readonly entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">,
    private readonly logger: Pick<Logger, "error" | "warn" | "info">,
  ) {}

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
        const expected = isUpgradeBehind(error);
        this.logger[expected ? "warn" : "error"](
          { error, projectId, customerTraceIds },
          "Error checking trace limit",
        );
        return;
      }
      this.logger.info(
        { projectId, customerTraceIds, ...error.meta },
        "Project has reached plan limit",
      );
      throw error;
    }
  }
}
