import {
  ClaimService,
  type OnboardingConfig,
  ProvisioningService,
  peppered,
  RateLimitGuard,
  resolveConfig,
} from "@langwatch/ai-onboarding";
import {
  RedisHandoffStore,
  type RedisLike,
  RedisRateLimiter,
} from "@langwatch/ai-onboarding/adapters";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";
import { PrismaEphemeralAccountRepository } from "./ephemeral-account.prisma.repository";
import { PrismaPasskeyRepository } from "./passkey.prisma.repository";
import { SimpleWebAuthnCeremony } from "./webauthn.ceremony";
import { LangWatchWorkspaceProvisioner } from "./workspace.provisioner";

/**
 * The composition root for the agent-onboarding service — the only place that
 * knows both the ports and the concrete adapters behind them.
 *
 * `@langwatch/ai-onboarding` is consumed here and nowhere else in the app.
 * That is the whole point of it being a package: the domain has one entry
 * point, so a second caller has to come through this route rather than
 * reaching past it into a repository.
 */

export interface OnboardingServices {
  provisioning: ProvisioningService;
  claim: ClaimService;
  config: OnboardingConfig;
}

let cached: OnboardingServices | null = null;

export function onboardingServices(): OnboardingServices {
  if (cached !== null) return cached;

  const config = resolveConfig({
    appBaseUrl: baseUrl(),
    provisioningEnabled: env.LANGWATCH_DISABLE_ANONYMOUS_ONBOARDING !== "true",
  });

  const accounts = PrismaEphemeralAccountRepository.create(prisma);
  const workspaces = LangWatchWorkspaceProvisioner.create(prisma);
  const handoffs = new RedisHandoffStore(requireRedis());
  const guard = new RateLimitGuard(
    new RedisRateLimiter(requireRedis()),
    config.rateLimits,
    pepper(),
  );

  cached = {
    config,
    provisioning: new ProvisioningService({
      accounts,
      workspaces,
      guard,
      config,
      pepper: pepper(),
    }),
    claim: new ClaimService({
      accounts,
      handoffs,
      workspaces,
      guard,
      config,
      pepper: pepper(),
      passkeys: PrismaPasskeyRepository.create(prisma),
      ceremony: new SimpleWebAuthnCeremony({
        appBaseUrl: config.appBaseUrl,
        rpName: "LangWatch",
      }),
    }),
  };
  return cached;
}

/**
 * The limiter and the handoff store both need Redis, and neither has a
 * meaningful degraded mode: without it, provisioning would be unmetered and a
 * handoff would have nowhere to live. Returning a proxy that throws on use
 * (rather than throwing here) keeps the failure inside a request, where the
 * guard turns it into a 503 the caller can read, instead of taking the whole
 * route module down at import time.
 */
function requireRedis(): RedisLike {
  return new Proxy({} as RedisLike, {
    get(_target, property) {
      if (!redisConnection) {
        throw new Error(
          "agent onboarding requires Redis; no connection is configured",
        );
      }
      return Reflect.get(redisConnection, property, redisConnection).bind(
        redisConnection,
      );
    },
  });
}

/**
 * Keyed-hash secret for claim tokens, handoff codes, fingerprints and
 * addresses. Derived from the app secret with a label rather than used raw, so
 * a hash from this surface tells you nothing about any other use of it.
 */
function pepper(): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for agent onboarding");
  }
  return peppered("agent-onboarding/v1", secret);
}

function baseUrl(): string {
  const host = env.BASE_HOST ?? env.NEXTAUTH_URL;
  if (!host) {
    throw new Error("BASE_HOST is required for agent onboarding");
  }
  return host.endsWith("/") ? host.slice(0, -1) : host;
}
