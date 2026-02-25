import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { env } from "~/env.mjs";
import type { UsageReportingJob } from "~/server/background/types";
import { withJobContext } from "../../context/asyncContext";
import { prisma } from "../../db";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  recordJobWaitDuration,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import { USAGE_REPORTING_QUEUE } from "../queues/constants";
import {
  getBillingMonth,
  getPreviousBillingMonth,
  billingMonthDateRange,
  queryBillableEventsTotal,
} from "../../../../ee/billing/services/billableEventsQuery";
import { 
  type PlanTypes, 
  SUBSCRIBABLE_PLANS } from "../../../../ee/billing/planTypes";
import { PricingModel } from "@prisma/client";

// Re-export for existing test imports
export { getBillingMonth, getPreviousBillingMonth, billingMonthDateRange };

const logger = createLogger("langwatch:workers:usageReportingWorker");

/** Stripe meter event name for billable events. */
const BILLABLE_EVENTS_EVENT_NAME = "langwatch_billable_events";

/** Delay before self-re-trigger in milliseconds (5 minutes). */
const RETRIGGER_DELAY_MS = 5 * 60 * 1000;

/** Number of days at the start of a new month to also check the previous month. */
const GRACE_PERIOD_DAYS = 3;

/**
 * Builds a deterministic idempotency key for Stripe meter events.
 * Format: `${organizationId}:${billingMonth}:from:${lastReportedTotal}:to:${targetTotal}`
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
 * Reports usage for a single billing month.
 *
 * Two-phase checkpoint protocol:
 * 1. Write `pendingReportedTotal` before calling Stripe (intent).
 * 2. On success, promote to `lastReportedTotal` and clear pending.
 *
 * If the process crashes between phases, the next run detects the
 * pending value and replays with the same deterministic identifier,
 * which Stripe deduplicates via its 24-hour idempotency window.
 */
async function reportForBillingMonth({
  organizationId,
  billingMonth,
  stripeCustomerId,
}: {
  organizationId: string;
  billingMonth: string;
  stripeCustomerId: string;
}): Promise<void> {
  const checkpoint = await prisma.billingMeterCheckpoint.findUnique({
    where: {
      organizationId_billingMonth: { organizationId, billingMonth },
    },
  });

  const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;

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
    const currentTotal = await queryBillableEventsTotal({
      organizationId,
      billingMonth,
    });

    if (currentTotal === null) {
      // ClickHouse not available
      return;
    }

    if (currentTotal <= lastReportedTotal) {
      logger.debug(
        { organizationId, billingMonth, currentTotal, lastReportedTotal },
        "no new billable events, skipping",
      );
      return;
    }

    targetTotal = currentTotal;

    // Phase 1: Write intent (pendingReportedTotal) before calling Stripe.
    await prisma.billingMeterCheckpoint.upsert({
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
    return;
  }

  const identifier = buildIdentifier({
    organizationId,
    billingMonth,
    lastReportedTotal,
    targetTotal,
  });

  // Dynamic import to avoid circular dependency with ee/billing
  const { getUsageReportingService } = await import(
    "../../../../ee/billing/index"
  );

  const results = await getUsageReportingService().reportUsageDelta({
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
      scope.setTag?.("worker", "usageReporting");
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
    await prisma.billingMeterCheckpoint.update({
      where: {
        organizationId_billingMonth: { organizationId, billingMonth },
      },
      data: {
        pendingReportedTotal: null,
      },
    });

    return;
  }

  // Phase 2: Confirm checkpoint - promote to lastReportedTotal, clear pending.
  await prisma.billingMeterCheckpoint.upsert({
    where: {
      organizationId_billingMonth: { organizationId, billingMonth },
    },
    create: {
      organizationId,
      billingMonth,
      lastReportedTotal: targetTotal,
      pendingReportedTotal: null,
    },
    update: {
      lastReportedTotal: targetTotal,
      pendingReportedTotal: null,
    },
  });

  logger.info(
    { organizationId, billingMonth, identifier, delta, targetTotal },
    "usage reported and checkpoint updated successfully",
  );
}

/**
 * Processes a single usage reporting job for an organization.
 */
export async function runUsageReportingJob(
  job: Job<UsageReportingJob, void, string>,
) {
  if (!env.IS_SAAS) {
    logger.debug("not in SaaS mode, skipping usage reporting job");
    return;
  }

  recordJobWaitDuration(job, "usage_reporting");
  const { organizationId } = job.data;
  logger.info(
    { jobId: job.id, organizationId },
    "processing usage reporting job",
  );
  getJobProcessingCounter("usage_reporting", "processing").inc();
  const start = Date.now();

  try {
    // ----------------------------------------------------------------
    // 1. Resolve org from DB
    // ----------------------------------------------------------------
    const org = await prisma.organization.findFirst({
      where: { id: organizationId, pricingModel: PricingModel.SEAT_EVENT },
      select: {
        id: true,
        stripeCustomerId: true,
        pricingModel: true,
        subscriptions: {
          where: { 
            status: "ACTIVE", 
            plan: { in: SUBSCRIBABLE_PLANS as unknown as PlanTypes[] } 
          },
          take: 1,
          select: { id: true }, orderBy: { startDate: "desc" },
        },
      },
    });

    if (!org) {
      logger.warn({ organizationId }, "organization not found, skipping");
      getJobProcessingCounter("usage_reporting", "completed").inc();
      return;
    }

    if (!org.stripeCustomerId) {
      logger.debug(
        { organizationId },
        "no Stripe customer ID, skipping usage reporting",
      );
      getJobProcessingCounter("usage_reporting", "completed").inc();
      return;
    }

    if (org.subscriptions.length === 0) {
      logger.debug(
        { organizationId },
        "no active subscription, skipping usage reporting",
      );
      getJobProcessingCounter("usage_reporting", "completed").inc();
      return;
    }

    // ----------------------------------------------------------------
    // 2. Report for current (and possibly previous) billing month
    // ----------------------------------------------------------------
    const now = new Date();
    const billingMonth = getBillingMonth(now);

    // Grace period: check previous month during first days of a new month
    // to catch late-arriving events that belong to the previous billing cycle
    if (now.getUTCDate() <= GRACE_PERIOD_DAYS) {
      const prevMonth = getPreviousBillingMonth(now);
      await reportForBillingMonth({
        organizationId,
        billingMonth: prevMonth,
        stripeCustomerId: org.stripeCustomerId,
      });
    }

    // Always check current month
    await reportForBillingMonth({
      organizationId,
      billingMonth,
      stripeCustomerId: org.stripeCustomerId,
    });

    // ----------------------------------------------------------------
    // 3. Self-re-trigger to catch any events that arrived during processing
    // ----------------------------------------------------------------
    try {
      // Dynamic import to avoid circular dependency with the queue module
      const { usageReportingQueue } = await import(
        "../queues/usageReportingQueue"
      );
      if (usageReportingQueue) {
        await usageReportingQueue.add(
          USAGE_REPORTING_QUEUE.JOB,
          { organizationId },
          {
            jobId: `usage_report_${organizationId}`,
            delay: RETRIGGER_DELAY_MS,
          },
        );
        logger.debug(
          { organizationId, delayMs: RETRIGGER_DELAY_MS },
          "self-re-triggered usage reporting job",
        );
      }
    } catch (retriggerError) {
      // Non-fatal: the next external trigger will pick up remaining events.
      logger.warn(
        { organizationId, error: retriggerError },
        "failed to self-re-trigger usage reporting job",
      );
    }

    getJobProcessingCounter("usage_reporting", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("usage_reporting").observe(duration);
  } catch (error) {
    logger.error(
      { jobId: job.id, organizationId, error },
      "failed to process usage reporting job",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "usageReporting");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
    throw error; // Re-throw for BullMQ retry
  }
}

/**
 * Starts the BullMQ worker for usage reporting jobs.
 * Only activates in SaaS mode with an available Redis connection.
 */
export const startUsageReportingWorker = () => {
  if (!env.IS_SAAS) {
    logger.info("not in SaaS mode, skipping usage reporting worker");
    return;
  }

  if (!connection) {
    logger.info("no redis connection, skipping usage reporting worker");
    return;
  }

  const usageReportingWorker = new Worker<UsageReportingJob, void, string>(
    USAGE_REPORTING_QUEUE.NAME,
    withJobContext(runUsageReportingJob),
    {
      connection,
      concurrency: 2,
      telemetry: new BullMQOtel(USAGE_REPORTING_QUEUE.NAME),
    },
  );

  usageReportingWorker.on("ready", () => {
    logger.info("usage reporting worker active, waiting for jobs!");
  });

  usageReportingWorker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    getJobProcessingCounter("usage_reporting", "failed").inc();
  });

  logger.info("usage reporting worker registered");
  return usageReportingWorker;
};
