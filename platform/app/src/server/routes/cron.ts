/**
 * Hono routes for cron jobs.
 */

import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { createServiceApp, internalSecret } from "~/server/api/security";
import cleanupOldLambdas from "~/tasks/cleanupOldLambdas";
import {
  reportHasFailures,
  type SeedRunReport,
} from "../../../scripts/dogfood/governance/_lib/seedRunner";
import { runSeedDemo } from "../../../scripts/dogfood/governance/seed-demo";
import { isInternalSecretValid, validateInternalSecret } from "./_lib/internal-secret";

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
    await cleanupOldLambdas(c.app.nlpLambda);
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
secured.access(cronPolicy()).get("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);
secured.access(cronPolicy()).post("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);

// NOTE: the `/api/cron/triggers` graph-alert sweep was removed (ADR-034):
// custom-graph threshold alerts now fire exclusively from the event-sourced
// path (real-time activity subscriber + scheduled graph-alert process manager),
// and trace-based triggers were already reactive. There is no cron graph-alert
// path anymore. Likewise the webhook delivery-log prune (ADR-040 §6) runs as
// the daily `webhookDeliveryPrune` scheduled process manager on the worker,
// not as a cron route.

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

export const app = secured.hono;
