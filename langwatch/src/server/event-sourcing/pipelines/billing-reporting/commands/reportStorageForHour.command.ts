import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import type { UsageReportingService } from "../../../../../../ee/billing/services/usageReportingService";
import { STORAGE_METER_EVENT_NAME } from "../../../../../../ee/billing/stripe/storagePricing";
import type { StorageBillingCheckpointService } from "../../../../app-layer/billing/storageBillingCheckpoint.service";
import type { StorageUsageHourlyRepository } from "../../../../app-layer/billing/storageUsageHourly.repository";
import type { OrganizationService } from "../../../../app-layer/organizations/organization.service";
import type { Command, CommandHandler } from "../../../";
import { defineCommandSchema } from "../../../";
import type { Event } from "../../../domain/types";
import type { ReportStorageForHourCommandData } from "../schemas/commands";
import { reportStorageForHourCommandDataSchema } from "../schemas/commands";
import { BILLING_REPORT_COMMAND_TYPES } from "../schemas/constants";

const logger = createLogger(
  "langwatch:billing-reporting:report-storage-for-hour",
);

/** Maximum consecutive failures before the circuit-breaker trips. */
const MAX_CONSECUTIVE_FAILURES = 5;

const ONE_MINUTE_MS = 60 * 1000;

type CachedOrgData = {
  id: string;
  stripeCustomerId: string | null;
  subscriptions: { id: string }[];
};

const orgCache = new TtlCache<CachedOrgData>(
  ONE_MINUTE_MS,
  "ttlcache:storage-billing:orgData:",
);

export interface ReportStorageForHourCommandDeps {
  organizations: OrganizationService;
  storageBillingCheckpoints: StorageBillingCheckpointService;
  storageUsageHourly: StorageUsageHourlyRepository;
  getUsageReportingService: () => UsageReportingService | undefined;
  selfDispatch: (data: ReportStorageForHourCommandData) => Promise<void>;
}

const SCHEMA = defineCommandSchema(
  BILLING_REPORT_COMMAND_TYPES.REPORT_STORAGE_FOR_HOUR,
  reportStorageForHourCommandDataSchema,
  "Command to report one measured storage hour to Stripe, additively",
);

/** The UTC billing month ("YYYY-MM") a sealed hour belongs to. */
function billingMonthOf(sealedHour: Date): string {
  return sealedHour.toISOString().slice(0, 7);
}

/**
 * Deterministic Stripe idempotency key for a sealed hour. Hour-precision ISO so
 * the same (org, hour) always produces the same identifier — Stripe dedups a
 * re-send within its window, billing the hour once.
 */
function buildIdentifier(organizationId: string, sealedHour: Date): string {
  return `storage_mb:${organizationId}:${sealedHour.toISOString().slice(0, 13)}`;
}

/**
 * Command handler for reporting one measured storage hour to Stripe.
 *
 * Additive, not delta: the hour's raw megabytes are sent once into a `sum`
 * meter (never a last-value set). Idempotency is the durable
 * `StorageUsageHourly.reportedAt` cursor plus the deterministic Stripe
 * identifier; the per-month checkpoint carries ONLY the circuit breaker
 * (consecutive failures) — it cannot disambiguate which hour was in flight, so
 * crash-recovery is the cursor, not a checkpoint accumulator (ADR-027 Phase 3).
 *
 * Error handling never propagates to the framework: every job is "successful";
 * the handler owns retry (self-dispatch on transient, breaker on repeated
 * failure). Uses constructor DI — pass the instance via `.withCommandInstance()`.
 */
export class ReportStorageForHourCommand
  implements CommandHandler<Command<ReportStorageForHourCommandData>, Event>
{
  static readonly schema = SCHEMA;

  constructor(private readonly deps: ReportStorageForHourCommandDeps) {}

  static getAggregateId(payload: ReportStorageForHourCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: ReportStorageForHourCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organizationId": payload.organizationId,
      "payload.sealedHour": payload.sealedHour,
    };
  }

  async handle(
    command: Command<ReportStorageForHourCommandData>,
  ): Promise<Event[]> {
    const { organizationId, sealedHour, tenantId } = command.data;

    let shouldSelfDispatch = false;
    try {
      let org = (await orgCache.get(organizationId)) ?? null;
      if (!org) {
        org =
          await this.deps.organizations.getOrganizationForBilling(
            organizationId,
          );
        if (org) {
          await orgCache.set(organizationId, org);
        }
      }

      if (!org) {
        logger.warn({ organizationId }, "organization not billable, skipping");
        return [];
      }
      if (!org.stripeCustomerId) {
        logger.debug({ organizationId }, "no Stripe customer ID, skipping");
        return [];
      }
      if (org.subscriptions.length === 0) {
        logger.debug({ organizationId }, "no active subscription, skipping");
        return [];
      }

      shouldSelfDispatch = await this.reportHour({
        organizationId,
        sealedHour,
        stripeCustomerId: org.stripeCustomerId,
      });
    } catch (error) {
      // Never propagate to framework — log and return empty events.
      logger.error(
        { organizationId, sealedHour, error },
        "unexpected error in storage reporting command handler",
      );
      await withScope(async (scope) => {
        scope.setTag?.("handler", "reportStorageForHour");
        scope.setExtra?.("organizationId", organizationId);
        scope.setExtra?.("sealedHour", sealedHour);
        captureException(toError(error));
      });
      return [];
    }

    // Self-dispatch (transient retry) outside try/catch so failures propagate.
    if (shouldSelfDispatch) {
      await this.deps.selfDispatch({
        organizationId,
        sealedHour,
        tenantId,
        occurredAt: Date.now(),
      });
    }

    return [];
  }

  /**
   * Reports one sealed hour. Returns true only when a transient error means the
   * same hour should be retried via self-dispatch; false on success, skip,
   * permanent rejection, or a tripped breaker.
   */
  private async reportHour({
    organizationId,
    sealedHour,
    stripeCustomerId,
  }: {
    organizationId: string;
    sealedHour: string;
    stripeCustomerId: string;
  }): Promise<boolean> {
    const sealedHourDate = new Date(sealedHour);
    const billingMonth = billingMonthOf(sealedHourDate);

    const checkpoint = await this.deps.storageBillingCheckpoints.getCheckpoint({
      organizationId,
      billingMonth,
    });
    const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error(
        { organizationId, billingMonth, consecutiveFailures },
        "ALARM: storage-billing circuit-breaker tripped — consecutive failures " +
          "exceeded threshold, stopping. Manual investigation required.",
      );
      return false;
    }

    const hour = await this.deps.storageUsageHourly.findHour({
      organizationId,
      sealedHour: sealedHourDate,
    });
    if (!hour) {
      logger.debug(
        { organizationId, sealedHour },
        "no measured storage hour, skipping",
      );
      return false;
    }
    if (hour.reportedAt != null) {
      logger.debug(
        { organizationId, sealedHour },
        "hour already reported, skipping",
      );
      return false;
    }
    if (hour.megabytes === 0) {
      // Nothing to bill for a 0-MiB hour (e.g. a default-keep org with no data
      // older than the free window — every hour is 0). Stamp the cursor so it
      // never re-dispatches, without a wasted 0-value Stripe call each hour.
      await this.deps.storageUsageHourly.markReported({
        organizationId,
        sealedHour: sealedHourDate,
        reportedAt: new Date(),
      });
      logger.debug(
        { organizationId, sealedHour },
        "zero-MiB hour, marked reported without a Stripe call",
      );
      return false;
    }

    const usageReportingService = this.deps.getUsageReportingService();
    if (!usageReportingService) {
      logger.error(
        { organizationId, sealedHour },
        "usageReportingService not available — billing requires isSaas, this is a configuration error",
      );
      return false;
    }

    const identifier = buildIdentifier(organizationId, sealedHourDate);

    try {
      const results = await usageReportingService.reportUsageDelta({
        stripeCustomerId,
        organizationId,
        events: [
          {
            eventName: STORAGE_METER_EVENT_NAME,
            identifier,
            timestamp: Math.floor(sealedHourDate.getTime() / 1000),
            value: hour.megabytes,
          },
        ],
      });

      const result = results[0];

      if (!result?.reported) {
        // Permanent rejection: leave the hour unreported (cursor stays null) so
        // a later run can retry; bump the breaker; do NOT self-dispatch.
        logger.error(
          { organizationId, sealedHour, identifier, error: result?.error },
          "Stripe permanently rejected storage meter event, hour left unreported",
        );
        await withScope(async (scope) => {
          scope.setTag?.("handler", "reportStorageForHour");
          scope.setExtra?.("organizationId", organizationId);
          scope.setExtra?.("identifier", identifier);
          scope.setExtra?.("stripeError", result?.error);
          captureException(
            new Error(
              `Stripe rejected storage meter event: ${result?.error ?? "unknown"}`,
            ),
          );
        });
        await this.deps.storageBillingCheckpoints.recordFailure({
          organizationId,
          billingMonth,
          consecutiveFailures: consecutiveFailures + 1,
        });
        return false;
      }

      // Success (including resource_already_exists, treated as reported by the
      // usage service). Stamp the cursor so the hour is never sent again.
      await this.deps.storageUsageHourly.markReported({
        organizationId,
        sealedHour: sealedHourDate,
        reportedAt: new Date(),
      });

      // Clear the breaker only if it had tripped partway — avoids a checkpoint
      // write on the clean happy path.
      if (consecutiveFailures > 0) {
        await this.deps.storageBillingCheckpoints.recordSuccess({
          organizationId,
          billingMonth,
        });
      }

      logger.debug(
        { organizationId, sealedHour, identifier, value: hour.megabytes },
        "storage hour reported and marked reported",
      );
      return false;
    } catch (error) {
      // Transient error (rate limit, network, transient DB): bump the breaker
      // and self-dispatch to retry the same hour.
      logger.warn(
        { organizationId, sealedHour, error },
        "transient error reporting storage hour, will retry via self-dispatch",
      );
      await this.deps.storageBillingCheckpoints.recordFailure({
        organizationId,
        billingMonth,
        consecutiveFailures: consecutiveFailures + 1,
      });
      return true;
    }
  }
}
