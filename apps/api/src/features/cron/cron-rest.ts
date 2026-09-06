/**
 * The internal cron family. A Kubernetes CronJob curls these paths with the
 * shared `CRON_API_KEY` bearer; nothing else may reach them, because a caller
 * reaching `old_lambdas_cleanup` can delete this deployment's Lambda functions.
 */

/*
 * The gate is BUILDER-LEVEL: `verifySecret` runs ahead of every handler, so a
 * route whose author forgets an in-handler check still ships authenticated. It
 * fails closed rather than letting `undefined === undefined` admit everyone.
 */
import { internalSecret, isInternalSecretValid } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { Context, MiddlewareHandler, Next } from "hono";

const logger = createLogger("langwatch:cron");

/** Everything the cron family runs that it does not own. */
export type CronRestPorts = Readonly<{
  /**
   * The shared bearer this surface is gated on, or none. A function rather
   * than a value: the deployment may configure it after the family is built,
   * and an unset secret must answer 503 rather than let the gate fall open.
   */
  internalSecret: () => string | undefined;
  /** Sweeps the studio's quiet NLP Lambda functions and their log groups. */
  cleanupOldLambdas: () => Promise<void>;
}>;

/**
 * Constant-time bearer check against the cron shared secret, applied as the
 * builder chain for every route. A plain `===` leaks the secret one byte at a
 * time to anything that can time our responses.
 */
export function verifyCronSecret(secretOf: () => string | undefined): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const secret = secretOf();
    if (!secret) {
      logger.error("CRON_API_KEY is not configured");
      return c.body(null, 401);
    }
    if (
      !isInternalSecretValid({
        authorizationHeader: c.req.header("authorization"),
        expected: secret,
      })
    ) {
      return c.body(null, 401);
    }
    await next();
    return;
  };
}

const cronPolicy = () =>
  internalSecret("cron shared secret enforced by the builder-level verifySecret middleware");

/** Builds the `/api/cron` family over one process's ports. */
export function createCronRestApp(options: {
  security: AppRestSecurity;
  ports: CronRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({
    basePath: "/api/cron",
    verifySecret: verifyCronSecret(ports.internalSecret),
  });

  const oldLambdasCleanupHandler = async (c: Context) => {
    try {
      await ports.cleanupOldLambdas();
      return c.json({ message: "Old lambdas deleted successfully" });
    } catch (error) {
      return c.json(
        {
          message: "Error deleting old lambdas",
          error: error instanceof Error ? error.message : `${String(error)}`,
        },
        500,
      );
    }
  };

  secured.access(cronPolicy()).get("/old_lambdas_cleanup", oldLambdasCleanupHandler);
  secured.access(cronPolicy()).post("/old_lambdas_cleanup", oldLambdasCleanupHandler);

  return secured.mountable;
}
