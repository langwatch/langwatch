/**
 * Hono routes for cron jobs.
 */

import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { env } from "~/env.mjs";
import { createServiceApp, internalSecret } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { scheduleTopicClustering } from "~/server/topicClustering/topicClusteringQueue";
import { WebhookDeliveryService } from "~/server/app-layer/triggers/webhook-delivery.service";
import cleanupOldLambdas from "~/tasks/cleanupOldLambdas";
import { reapExpiredLangySessionApiKeys } from "~/server/app-layer/langy/langyApiKey";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  reportHasFailures,
  type SeedRunReport,
} from "../../../scripts/dogfood/governance/_lib/seedRunner";
import { runSeedDemo } from "../../../scripts/dogfood/governance/seed-demo";
import {
  isInternalSecretValid,
  validateInternalSecret,
} from "./_lib/internal-secret";

const logger = createLogger("langwatch:cron");

// Builder-enforced secret gate: every route registered on this app passes
// through the shared-secret check before its handler runs, so a future cron
// route whose author forgets the in-handler validateCronKey call still ships
// authenticated. The per-handler checks below stay as belt-and-braces.
const secured = createServiceApp({
  basePath: "/api",
  verifySecret: async (c, next) => {
    if (!isInternalSecretValid(c.req.header("authorization"))) {
      return c.body(null, 401);
    }
    await next();
  },
});

type CronContext = Context;

const cronPolicy = () =>
  internalSecret(
    "cron shared secret enforced by the builder-level verifySecret middleware " +
      "(and re-checked in-handler via validateInternalSecret)",
  );

/** Validates the cron shared secret. See validateInternalSecret (fail-closed + constant-time). */
function validateCronKey(c: CronContext): boolean {
  return validateInternalSecret(c);
}

// ---------- GET|POST /api/cron/old_lambdas_cleanup ----------
const oldLambdasCleanupHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  try {
    await cleanupOldLambdas();
    return c.json({ message: "Old lambdas deleted successfully" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error deleting old lambdas",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
};
secured
  .access(cronPolicy())
  .get("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);
secured
  .access(cronPolicy())
  .post("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);

// ---------- GET|POST /api/cron/webhook_delivery_cleanup ----------
// ADR-040 §6: prune webhook delivery-log rows older than 30 days. Postgres is
// outside the ClickHouse retention sweep, so the log needs its own cleaner.
const webhookDeliveryCleanupHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }
  try {
    const deleted = await WebhookDeliveryService.create(prisma).pruneExpired();
    return c.json({ message: "Webhook delivery log pruned", deleted });
  } catch (error: any) {
    return c.json(
      {
        message: "Error pruning webhook delivery log",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
};
secured
  .access(cronPolicy())
  .get("/cron/webhook_delivery_cleanup", webhookDeliveryCleanupHandler);
secured
  .access(cronPolicy())
  .post("/cron/webhook_delivery_cleanup", webhookDeliveryCleanupHandler);

// ---------- GET|POST /api/cron/schedule_topic_clustering ----------
const scheduleTopicClusteringHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }
  try {
    await scheduleTopicClustering();
    return c.json({ message: "Topic clustering scheduled" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error scheduling topic clustering",
        error: error?.message ? error?.message.toString() : `${error}`,
      },
      500,
    );
  }
};
secured
  .access(cronPolicy())
  .get("/cron/schedule_topic_clustering", scheduleTopicClusteringHandler);
secured
  .access(cronPolicy())
  .post("/cron/schedule_topic_clustering", scheduleTopicClusteringHandler);

// ---------- GET /api/cron/trace_analytics ----------
secured.access(cronPolicy()).get("/cron/trace_analytics", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  // Check usage limits for all organizations (SaaS only)
  if (env.IS_SAAS) {
    try {
      const organizations = await prisma.organization.findMany({
        select: { id: true },
      });

      const usageService = getApp().usage;

      for (const org of organizations) {
        try {
          const projectIds = await getApp().organizations.getProjectIds(org.id);
          if (projectIds.length === 0) {
            logger.debug(
              { organizationId: org.id },
              "organization has no projects, skipping",
            );
            continue;
          }
          const currentMonthCount = await usageService.getCurrentMonthCount({
            organizationId: org.id,
          });

          if (currentMonthCount === "unlimited") {
            logger.debug(
              { organizationId: org.id },
              "organization has unlimited plan, skipping usage check",
            );
            continue;
          }

          const activePlan = await getApp().planProvider.getActivePlan({
            organizationId: org.id,
          });

          if (
            !activePlan ||
            typeof activePlan.maxMessagesPerMonth !== "number" ||
            activePlan.maxMessagesPerMonth <= 0
          ) {
            logger.debug(
              { organizationId: org.id },
              "organization has invalid or missing plan configuration, skipping",
            );
            continue;
          }

          const maxMessagesPerMonth = activePlan.maxMessagesPerMonth;
          const usagePercentage =
            maxMessagesPerMonth > 0
              ? (currentMonthCount / maxMessagesPerMonth) * 100
              : 0;

          if (currentMonthCount > 1) {
            logger.info(
              {
                organizationId: org.id,
                currentMonthMessagesCount: currentMonthCount,
                maxMessagesPerMonth,
                usagePercentage: Number(usagePercentage.toFixed(1)),
                projectCount: projectIds.length,
              },
              "organization usage stats",
            );
          }

          await getApp().usageLimits.checkAndSendWarning({
            organizationId: org.id,
            currentMonthMessagesCount: currentMonthCount,
            maxMonthlyUsageLimit: maxMessagesPerMonth,
          });
        } catch (error) {
          logger.error(
            { organizationId: org.id, error },
            "error checking usage limits for organization",
          );
          captureException(toError(error), {
            extra: { organizationId: org.id },
          });
        }
      }
    } catch (error) {
      logger.error({ error }, "error checking usage limits");
      captureException(toError(error));
    }
  } else {
    logger.debug("skipping usage limit notifications (not SaaS)");
  }

  return c.json({ success: true });
});

// NOTE: the `/api/cron/triggers` graph-alert sweep was removed (ADR-034):
// custom-graph threshold alerts now fire exclusively from the event-sourced
// path (real-time outbox reactor + 30s heartbeat), and trace-based triggers
// were already reactive. There is no cron graph-alert path anymore.

// ---------- POST /api/cron/seed_demo ----------
//
// Triggers a daily reset of the canonical demo org allowlist. The
// langwatch-saas Kubernetes CronJob curls this route with the
// `CRON_API_KEY` Bearer header. `runSeedDemo` is the same code path the
// dev CLI uses (`scripts/dogfood/governance/seed-demo.ts`), gated by
// the `DEMO_ORG_IDS` allowlist guard so an unset env returns a clean
// 500 instead of touching real customer data.
//
// Returns the SeedRunReport JSON either way; HTTP 500 when any action
// failed so CronJob alerting can fire on the response code.
const seedDemoHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }
  let report: SeedRunReport;
  try {
    report = await runSeedDemo({ execute: true });
  } catch (error: any) {
    logger.error({ error }, "demo seed run threw before completing");
    return c.json(
      {
        message: "demo seed run threw",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
  const status = reportHasFailures(report) ? 500 : 200;
  return c.json({ report }, status);
};
secured.access(cronPolicy()).get("/cron/seed_demo", seedDemoHandler);
secured.access(cronPolicy()).post("/cron/seed_demo", seedDemoHandler);

/**
 * Revokes every Langy session key whose lifetime has elapsed.
 *
 * THIS IS THE GUARANTEE. The agent manager revokes a worker's session key the
 * moment it sees the worker die, which is the fast path and covers the ordinary
 * cases — capability change, idle reap, shutdown, crash. But a manager that is
 * SIGKILLed (OOM, node eviction, `--force` delete) sees nothing and runs no
 * cleanup at all, and every key its workers held then stays valid for the rest of
 * its TTL. No callback can close that hole: the process that would make the call
 * is the one that died.
 *
 * So this reaper is not redundant with revocation-on-death — it is what makes the
 * scheme safe, and removing it would reintroduce the long tail of live, orphaned
 * credentials the whole change set out to remove.
 */
const langySessionKeysReapHandler = async (c: CronContext) => {
  if (!validateInternalSecret(c)) return c.body(null, 401);
  try {
    const revoked = await reapExpiredLangySessionApiKeys({ prisma });
    // Worth watching: a number that stays stubbornly high means workers are dying
    // without their manager noticing, i.e. the fast path is not firing.
    if (revoked > 0) {
      logger.info({ revoked }, "reaped expired Langy session keys");
    }
    return c.json({ revoked });
  } catch (error) {
    logger.error({ error }, "reaping expired Langy session keys failed");
    captureException(toError(error), {
      extra: { context: "cron:langy_session_keys_reap" },
    });
    return c.json({ error: "reap failed" }, { status: 500 });
  }
};

secured
  .access(cronPolicy())
  .get("/cron/langy_session_keys_reap", langySessionKeysReapHandler);
secured
  .access(cronPolicy())
  .post("/cron/langy_session_keys_reap", langySessionKeysReapHandler);

export const app = secured.hono;
