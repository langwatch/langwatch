/**
 * Which classifier this deployment judges with, and the one instance of it.
 *
 * Chosen from configuration, fail-safe rather than fail-closed: no key means
 * the null classifier, which skips every question instead of refusing every
 * query. A self-hosted install that never sets `JEV_API_KEY` therefore sees the
 * eval functions published as unavailable rather than seeing them break.
 *
 * Three in order, and the order is the rule that the install's own key always
 * wins: an install that configured a judge of its own keeps judging with it
 * and sends nothing to LangWatch, whatever else is switched on. Connect comes
 * next, for an install with a license and no key of its own. The null
 * classifier is what is left.
 *
 * One instance per process because the transport is a keep-alive pool and the
 * rate limiter holds permits drawn from a shared bucket; building a second
 * would double both.
 *
 * @see ./classifier.ts
 */

import { ConnectInstantEvalClassifier } from "@ee/licensing/connect/install/connectClassifier";
import { readConnectConfig } from "@ee/licensing/connect/install/connectConfig";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { tryGetApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import type { InstantEvalClassifier } from "./classifier";
import { RedisInstantEvalRateLimiter } from "./globalRateLimiter";
import { JevInstantEvalClassifier } from "./jev.client";
import { NullInstantEvalClassifier } from "./null.client";

const logger = createLogger("langwatch:instant-evals:classifier");

/**
 * Input tokens a second the deployment may send when nothing says otherwise.
 *
 * Just under the ceiling the provider sustained in the September 2026 bench,
 * about 315k input tokens a second, so the bucket is the thing that governs
 * throughput and the provider's own 429 is the backstop rather than the norm.
 */
const DEFAULT_GLOBAL_TOKENS_PER_SECOND = 300_000;

/**
 * Input tokens a second one tenant may send when nothing says otherwise.
 *
 * Half the global rate: one project can never hold the whole ceiling, and two
 * busy ones split it, which is what keeps a hundred-thousand-row run from
 * queueing every other project's synchronous query behind it.
 */
const DEFAULT_TENANT_TOKENS_PER_SECOND = 150_000;

/**
 * Seconds of refill a bucket holds as burst.
 *
 * Two: enough that a query's first wave of parallel classifications starts
 * immediately, and small enough that the burst is over in two seconds at the
 * sustained rate the provider measured.
 */
const BUCKET_BURST_SECONDS = 2;

let cached: InstantEvalClassifier | undefined;

/** Whether this deployment can judge anything at all. */
export function isInstantEvalClassifierConfigured(): boolean {
  if (env.INSTANT_EVAL_CLASSIFIER === "null") return false;
  if (env.JEV_API_KEY) return true;
  // The Connect classifier answers per organization, and an organization
  // whose license names no hosted judging skips every question. Whether it can
  // judge for anyone is decided there, not here.
  return readConnectConfig().permitted;
}

/**
 * Whether the deployment's classifier can judge for one organization.
 *
 * Yes for a deployment-wide key, which every organization on the install
 * shares. The Connect classifier is the one that answers otherwise: hosted
 * judging is switched on per organization, and one that has not switched it on
 * publishes the eval functions as unavailable instead of running queries whose
 * judged columns all come back null.
 */
export async function isInstantEvalClassifierAvailableForOrganization(
  organizationId: string,
): Promise<boolean> {
  const classifier = getInstantEvalClassifier();
  return (
    (await classifier.isAvailableForOrganization?.(organizationId)) ?? true
  );
}

/**
 * The process's classifier.
 *
 * Built on first use rather than at boot: a deployment whose callers never
 * write an eval function never opens a connection pool.
 */
export function getInstantEvalClassifier(): InstantEvalClassifier {
  return (cached ??= createInstantEvalClassifier());
}

function createInstantEvalClassifier(): InstantEvalClassifier {
  if (env.INSTANT_EVAL_CLASSIFIER === "null") {
    return new NullInstantEvalClassifier();
  }

  const apiKey = env.JEV_API_KEY;
  if (!apiKey) {
    const config = readConnectConfig();
    if (config.permitted) {
      return new ConnectInstantEvalClassifier({ prisma, config });
    }
    logger.info(
      "No Instant Evals classifier is configured; judged columns will be skipped",
    );
    return new NullInstantEvalClassifier();
  }

  return new JevInstantEvalClassifier({
    apiKey,
    ...(env.JEV_BASE_URL ? { baseUrl: env.JEV_BASE_URL } : {}),
    // `jev-latest` is the name the API accepts and is what it resolves to a
    // concrete version (`jev-1.13.0` as of September 2026); a version spelled
    // out, such as `jev-1.13`, is refused as an unknown model. This is here so
    // a deployment can pin whatever concrete name the provider later publishes
    // without a release.
    ...(env.JEV_MODEL ? { model: env.JEV_MODEL } : {}),
    limiter: createInstantEvalRateLimiter(),
  });
}

/** The shared limiter, sized from the environment. */
function createInstantEvalRateLimiter(): RedisInstantEvalRateLimiter {
  const tokensPerSecond =
    env.INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND ??
    DEFAULT_GLOBAL_TOKENS_PER_SECOND;
  const tenantTokensPerSecond = Math.min(
    tokensPerSecond,
    env.INSTANT_EVAL_TENANT_TOKENS_PER_SECOND ??
      DEFAULT_TENANT_TOKENS_PER_SECOND,
  );
  return new RedisInstantEvalRateLimiter({
    // Read inside the factory, never at module scope: the container is built
    // during boot and a module-scope read would capture `null` for the life
    // of the process (ADR-093).
    redis: tryGetApp()?.redis ?? null,
    tokensPerSecond,
    capacity: tokensPerSecond * BUCKET_BURST_SECONDS,
    tenantTokensPerSecond,
    tenantCapacity: tenantTokensPerSecond * BUCKET_BURST_SECONDS,
  });
}

/** Drops the cached classifier. For suites, and for a clean shutdown. */
export async function resetInstantEvalClassifier(): Promise<void> {
  const previous = cached;
  cached = undefined;
  await previous?.close?.();
}
