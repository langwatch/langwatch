import type { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";
/**
 * Builds ModelProviderInfrastructure from redis, config and peers. Managed status comes from
 * the managed-provider peer; spans is always undefined (no untyped peer).
 */

import { modelProviderConnectionPingChannels } from "../channels/model-provider-connection-ping-channels.registry.ts";
import { CodexAccountService } from "../services/codex-account.service.ts";
import { CodexOAuthModelProviderTokenRefresherService } from "../services/codex-oauth-model-provider-token-refresher.service.ts";
import { HttpModelProviderCredentialProbeService } from "../services/http-model-provider-credential-probe.service.ts";
import { ManagedModelProviderGatewayService } from "../services/managed-model-provider-gateway.service.ts";
import { PrefixedModelProviderIdService } from "../services/prefixed-model-provider-id.service.ts";
import { RegistryModelProviderCatalogService } from "../services/registry-model-provider-catalog.service.ts";
import { SsrfModelProviderEgressService } from "../services/ssrf-model-provider-egress.service.ts";
import { VercelAiModelTranslationService } from "../services/vercel-ai-model-translation.service.ts";
import { WindowedModelProviderConnectionRateLimiterService } from "../services/windowed-model-provider-connection-rate-limiter.service.ts";
import type {
  ModelProviderBuildConfig,
  ModelProviderInfrastructure,
} from "./model-provider.app.ts";
import { ModelProviderRateLimit } from "./model-provider.members.ts";

/**
 * Connection-test limiter counter over process Redis with per-call window/max (organization
 * and global), not construction-time constants like {@link
 * WindowedModelProviderConnectionRateLimiterService}.
 */
class RedisModelProviderRateLimit extends ModelProviderRateLimit {
  static create(input: { redis: RedisConnection }): RedisModelProviderRateLimit {
    return new RedisModelProviderRateLimit(input.redis);
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  async consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }> {
    const counter = `model-provider:rate-limit:${input.key}`;
    const now = nowInstant().epochMilliseconds;
    const used = await this.redis.incr(counter);
    if (used === 1) await this.redis.expire(counter, input.windowSeconds);
    if (used <= input.max) {
      return { allowed: true, resetAt: now + input.windowSeconds * 1000 };
    }

    const remaining = await this.redis.ttl(counter);
    return { allowed: false, resetAt: now + Math.max(remaining, 0) * 1000 };
  }
}

/** What this process hands `ModelProviderApp` at boot. */
export function buildModelProviderInfrastructure(input: {
  members: Readonly<{ redis: RedisConnection }>;
  config: ModelProviderBuildConfig;
  dependencies: Readonly<{ projects: ProjectApi; managed: ManagedProviderApi }>;
}): ModelProviderInfrastructure {
  const { members, config, dependencies } = input;
  const egress = SsrfModelProviderEgressService.create({ policy: config.egress });
  // The catalogue's own probe and this application's `credentialProbe`
  // member are the SAME behaviour — a vendor-bound HTTP check behind the
  // deployment's SSRF fence — so one instance serves both rather than two
  // that could drift.
  const probe = HttpModelProviderCredentialProbeService.create({
    egress,
    environment: config.environment,
  });

  return {
    catalog: RegistryModelProviderCatalogService.create({
      managed: ManagedModelProviderGatewayService.create({
        managed: dependencies.managed,
        projects: dependencies.projects,
      }),
      probe,
      systemProviderEnvironment: config.environment,
      isSaas: config.isSaas,
    }),
    translation: VercelAiModelTranslationService.create({
      projects: dependencies.projects,
      executionProxyBaseUrl: config.executionProxyBaseUrl,
      // No `codexHandles`: see the module docblock on `model-provider.members.ts`.
    }),
    connectionPing: modelProviderConnectionPingChannels.live.create({
      executionProxyBaseUrl: config.executionProxyBaseUrl,
    }),
    ids: PrefixedModelProviderIdService.create(),
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherService.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterService.create({
      limiter: RedisModelProviderRateLimit.create({ redis: members.redis }),
    }),
    credentialProbe: probe,
    codexAccounts: CodexAccountService.create(),
    // No trace read stack is composed at this seam. See the module docblock.
    spans: undefined,
  };
}
