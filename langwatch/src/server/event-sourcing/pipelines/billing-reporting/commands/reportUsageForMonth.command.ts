import type { PrismaClient } from "@prisma/client";
import { PricingModel } from "@prisma/client";
import type { Command, CommandHandler } from "../../../";
import { defineCommandSchema } from "../../../";
import { createLogger } from "~/utils/logger/server";
import {
  captureException,
  withScope,
} from "~/utils/posthogErrorCapture";
import { GROWTH_SEAT_PLAN_TYPES } from "../../../../../../ee/billing/utils/growthSeatEvent";
import type { UsageReportingService } from "../../../../../../ee/billing/services/usageReportingService";
import { TtlCache } from "~/server/utils/ttlCache";
import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "../../../../../../ee/billing/services/billableEventsQuery";
import type { ReportUsageForMonthCommandData } from "../schemas/commands";
import { reportUsageForMonthCommandDataSchema } from "../schemas/commands";
import { BILLING_REPORT_COMMAND_TYPES } from "../schemas/constants";
import type { Event } from "../../../domain/types";

const logger = createLogger(
  "langwatch:billing-reporting:report-usage-for-month",
);

/** Stripe meter event name for billable events. */
const BILLABLE_EVENTS_EVENT_NAME = "langwatch_billable_events";

/** Maximum consecutive failures before circuit-breaker trips. */
const MAX_CONSECUTIVE_FAILURES = 5;

const ONE_MINUTE_MS = 60 * 1000;

type CachedOrgData = {
  id: string;
  stripeCustomerId: string | null;
  subscriptions: { id: string }[];
};

const orgCache = new TtlCache<CachedOrgData>(ONE_MINUTE_MS);

/** Exposed for testing: clears the org cache. */
export function clearOrgCache(): void {
  orgCache.clear();
}

export interface ReportUsageForMonthCommandDeps {
  prisma: PrismaClient;
  getUsageReportingService: () => UsageReportingService | undefined;
  queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  selfDispatch: (data: ReportUsageForMonthCommandData) => Promise<void>;
}

const SCHEMA = defineCommandSchema(
  BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
  reportUsageForMonthCommandDataSchema,
  "Command to report usage for a billing month to Stripe",
);

function getAggregateId(
  payload: ReportUsageForMonthCommandData,
): string {
  return payload.organizationId;
}

function getSpanAttributes(
  payload: ReportUsageForMonthCommandData,
): Record<string, string | number | boolean> {
  return {
    "payload.organizationId": payload.organizationId,
    "payload.billingMonth": payload.billingMonth,
  };
}

/**
 * Builds a deterministic idempotency key for Stripe meter events.
 */
function buildIdentifier({
  organizationId,
  billingMonth,
  lastReportedTotal,
  targetTotal,
}: {
  organizationId: string;
  billingMonth: string;
  lastReportedTotal: number;
  targetTotal: number;
}): string {
  return `${organizationId}:${billingMonth}:from:${lastReportedTotal}:to:${targetTotal}`;
}

/**
 * Factory that returns a CommandHandlerClass for reporting usage to Stripe.
 *
 * Extracted from usageReportingWorker.ts. The handler:
 * 1. Checks skip conditions (org exists, has Stripe customer, active subscription, SEAT_EVENT pricing)
 * 2. Two-phase checkpoint protocol: write pending → call Stripe → confirm
 * 3. Self-dispatches when delta > 0 for convergence loop
 * 4. Circuit-breaker on consecutive failures (stops self-dispatch after MAX_CONSECUTIVE_FAILURES)
 *
 * Error handling: never propagates to framework. All errors caught internally.
 * The framework sees every job as "successful" — the handler owns all retry logic.
 *
 * Note: The framework's commandDispatcher.ts validates the payload schema BEFORE calling handle().
 * If validation fails, a ValidationError propagates to the framework. This is safe because
 * send() pre-validates the same schema — a payload that passes send() will always pass process().
 */
export function createReportUsageForMonthCommandClass(
  deps: ReportUsageForMonthCommandDeps,
) {
  return class ReportUsageForMonthCommand
    implements CommandHandler<Command<ReportUsageForMonthCommandData>, Event>
  {
    static readonly schema = SCHEMA;
    static readonly getAggregateId = getAggregateId;
    static readonly getSpanAttributes = getSpanAttributes;

    async handle(
      command: Command<ReportUsageForMonthCommandData>,
    ): Promise<Event[]> {
      const { organizationId, billingMonth, tenantId } = command.data;

      let shouldSelfDispatch = false;
      try {
        // 1. Skip conditions
        let org = orgCache.get(organizationId) ?? null;
        if (!org) {
          org = await deps.prisma.organization.findFirst({
            where: { id: organizationId, pricingModel: PricingModel.SEAT_EVENT },
            select: {
              id: true,
              stripeCustomerId: true,
              subscriptions: {
                where: {
                  status: "ACTIVE",
                  plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
                },
                take: 1,
                select: { id: true },
                orderBy: { startDate: "desc" },
              },
            },
          });
          if (org) {
            orgCache.set(organizationId, org);
          }
        }

        if (!org) {
          logger.warn(
            { organizationId },
            "organization not found or not SEAT_EVENT, skipping",
          );
          return [];
        }

        if (!org.stripeCustomerId) {
          logger.debug(
            { organizationId },
            "no Stripe customer ID, skipping usage reporting",
          );
          return [];
        }

        if (org.subscriptions.length === 0) {
          logger.debug(
            { organizationId },
            "no active subscription, skipping usage reporting",
          );
          return [];
        }

        // 2. Report for billing month
        shouldSelfDispatch = await this.reportForBillingMonth({
          organizationId,
          billingMonth,
          stripeCustomerId: org.stripeCustomerId,
        });
      } catch (error) {
        // Never propagate to framework — log and return empty events
        logger.error(
          { organizationId, billingMonth, error },
          "unexpected error in usage reporting command handler",
        );
        await withScope(async (scope) => {
          scope.setTag?.("handler", "reportUsageForMonth");
          scope.setExtra?.("organizationId", organizationId);
          scope.setExtra?.("billingMonth", billingMonth);
          captureException(error);
        });
        return [];
      }

      // 3. Self-dispatch for convergence loop (outside try/catch so failures propagate)
      if (shouldSelfDispatch) {
        await deps.selfDispatch({
          organizationId,
          billingMonth,
          tenantId,
          occurredAt: Date.now(),
        });
      }

      return [];
    }

    /**
     * Two-phase checkpoint protocol:
     * 1. Write `pendingReportedTotal` before calling Stripe (intent).
     * 2. On success, promote to `lastReportedTotal` and clear pending.
     *
     * Returns true if self-dispatch should fire (delta was reported successfully).
     */
    private async reportForBillingMonth({
      organizationId,
      billingMonth,
      stripeCustomerId,
    }: {
      organizationId: string;
      billingMonth: string;
      stripeCustomerId: string;
    }): Promise<boolean> {
      const checkpoint =
        await deps.prisma.billingMeterCheckpoint.findUnique({
          where: {
            organizationId_billingMonth: { organizationId, billingMonth },
          },
        });

      const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;
      const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;

      // Circuit-breaker: stop self-dispatch after too many consecutive failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error(
          {
            organizationId,
            billingMonth,
            consecutiveFailures,
          },
          "ALARM: circuit-breaker tripped — consecutive failures exceeded threshold, " +
            "stopping self-dispatch. Manual investigation required.",
        );
        return false;
      }

      let targetTotal: number;

      if (checkpoint?.pendingReportedTotal != null) {
        // Crash recovery: a previous run wrote the intent but never confirmed.
        targetTotal = checkpoint.pendingReportedTotal;
        logger.info(
          { organizationId, billingMonth, targetTotal, lastReportedTotal },
          "recovering pending checkpoint from previous crash",
        );
      } else {
        // Normal path: query ClickHouse for deduplicated count.
        const currentTotal = await deps.queryBillableEventsTotal({
          organizationId,
          billingMonth,
        });

        if (currentTotal === null) {
          // ClickHouse not available
          return false;
        }

        if (currentTotal <= lastReportedTotal) {
          logger.debug(
            {
              organizationId,
              billingMonth,
              currentTotal,
              lastReportedTotal,
            },
            "no new billable events, skipping",
          );
          return false;
        }

        targetTotal = currentTotal;

        // Phase 1: Write intent (pendingReportedTotal) before calling Stripe.
        await deps.prisma.billingMeterCheckpoint.upsert({
          where: {
            organizationId_billingMonth: { organizationId, billingMonth },
          },
          create: {
            organizationId,
            billingMonth,
            lastReportedTotal,
            pendingReportedTotal: targetTotal,
          },
          update: {
            pendingReportedTotal: targetTotal,
          },
        });
      }

      // Compute delta and report to Stripe
      const delta = targetTotal - lastReportedTotal;
      if (delta <= 0) {
        logger.debug(
          { organizationId, billingMonth, targetTotal, lastReportedTotal },
          "non-positive delta, skipping Stripe report",
        );
        return false;
      }

      const identifier = buildIdentifier({
        organizationId,
        billingMonth,
        lastReportedTotal,
        targetTotal,
      });

      const usageReportingService = deps.getUsageReportingService();
      if (!usageReportingService) {
        logger.error(
          { organizationId, billingMonth },
          "usageReportingService not available — billing requires isSaas, this is a configuration error",
        );
        return false;
      }

      try {
        const results = await usageReportingService
          .reportUsageDelta({
            stripeCustomerId,
            organizationId,
            events: [
              {
                eventName: BILLABLE_EVENTS_EVENT_NAME,
                identifier,
                timestamp: Math.floor(Date.now() / 1000),
                value: delta,
              },
            ],
          });

        const result = results[0];

        if (!result || !result.reported) {
          // Permanent Stripe rejection: do NOT update checkpoint.
          logger.error(
            {
              organizationId,
              billingMonth,
              identifier,
              delta,
              error: result?.error,
            },
            "Stripe permanently rejected meter event, checkpoint NOT updated",
          );
          await withScope(async (scope) => {
            scope.setTag?.("handler", "reportUsageForMonth");
            scope.setExtra?.("organizationId", organizationId);
            scope.setExtra?.("identifier", identifier);
            scope.setExtra?.("delta", delta);
            scope.setExtra?.("stripeError", result?.error);
            captureException(
              new Error(
                `Stripe rejected meter event: ${result?.error ?? "unknown"}`,
              ),
            );
          });

          // Clear pending so subsequent runs don't replay the rejected delta forever.
          await deps.prisma.billingMeterCheckpoint.update({
            where: {
              organizationId_billingMonth: { organizationId, billingMonth },
            },
            data: {
              pendingReportedTotal: null,
              consecutiveFailures: consecutiveFailures + 1,
            },
          });

          return false;
        }

        // Phase 2: Confirm checkpoint - promote to lastReportedTotal, clear pending, reset failures.
        await deps.prisma.billingMeterCheckpoint.upsert({
          where: {
            organizationId_billingMonth: { organizationId, billingMonth },
          },
          create: {
            organizationId,
            billingMonth,
            lastReportedTotal: targetTotal,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          },
          update: {
            lastReportedTotal: targetTotal,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          },
        });

        logger.info(
          {
            organizationId,
            billingMonth,
            identifier,
            delta,
            targetTotal,
          },
          "usage reported and checkpoint updated successfully",
        );

        return true;
      } catch (error) {
        // Transient error (Stripe rate limit, network, etc.)
        // Increment consecutive failures, but allow self-dispatch for convergence
        logger.warn(
          { organizationId, billingMonth, error },
          "transient error reporting usage to Stripe, will retry via self-dispatch",
        );

        await deps.prisma.billingMeterCheckpoint.upsert({
          where: {
            organizationId_billingMonth: { organizationId, billingMonth },
          },
          create: {
            organizationId,
            billingMonth,
            lastReportedTotal,
            pendingReportedTotal: targetTotal,
            consecutiveFailures: consecutiveFailures + 1,
          },
          update: {
            consecutiveFailures: consecutiveFailures + 1,
          },
        });

        return true;
      }
    }
  };
}
