import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
/**
 * Builds ModelProviderInfrastructure (previously hand-composed) from redis
 * and config. Two intentional branches: managed is always Unmanaged (core
 * may not import Enterprise); spans is always undefined (no untyped peer).
 */
import { nanoid } from "nanoid";

import { modelProviderConnectionPingChannels } from "../channels/model-provider-connection-ping-channels.registry.ts";
import {
  CodexAccountService,
  CodexOAuthModelProviderTokenRefresherAdapter,
} from "../services/codex-oauth.model-provider-token-refresher.service.ts";
import { HttpModelProviderCredentialProbeAdapter } from "../services/http.model-provider-credential-probe.service.ts";
import { PrefixedModelProviderIdAdapter } from "../services/prefixed.model-provider-id.service.ts";
import { RegistryModelProviderCatalogAdapter } from "../services/registry.model-provider-catalog.service.ts";
import { SsrfModelProviderEgressAdapter } from "../services/ssrf.model-provider-egress.service.ts";
import { UnmanagedModelProviderGatewayAdapter } from "../services/unmanaged.model-provider-gateway.service.ts";
import { VercelAiModelTranslationAdapter } from "../services/vercel-ai.model-translation.service.ts";
import { WindowedModelProviderConnectionRateLimiterAdapter } from "../services/windowed.model-provider-connection-rate-limiter.service.ts";
import type {
  ModelProviderBuildConfig,
  ModelProviderInfrastructure,
} from "./model-provider.app.ts";
import { ModelProviderRateLimit } from "./model-provider.members.ts";

/**
 * Connection-test limiter counter over process Redis with per-call window/max (organization
 * and global), not construction-time constants like {@link
 * WindowedModelProviderConnectionRateLimiterAdapter}.
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
    const now = Date.now();
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
  dependencies: Readonly<{ projects: ProjectApi }>;
}): ModelProviderInfrastructure {
  const { members, config, dependencies } = input;
  const egress = SsrfModelProviderEgressAdapter.create({ policy: config.egress });
  // The catalogue's own probe and this application's `credentialProbe`
  // member are the SAME behaviour — a vendor-bound HTTP check behind the
  // deployment's SSRF fence — so one instance serves both rather than two
  // that could drift.
  const probe = HttpModelProviderCredentialProbeAdapter.create({
    egress,
    environment: config.environment,
  });

  return {
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed: UnmanagedModelProviderGatewayAdapter.create(),
      probe,
      systemProviderEnvironment: config.environment,
      isSaas: config.isSaas,
    }),
    translation: VercelAiModelTranslationAdapter.create({
      projects: dependencies.projects,
      executionProxyBaseUrl: config.executionProxyBaseUrl,
      // No `codexHandles`: see the module docblock on `model-provider.members.ts`.
    }),
    connectionPing: modelProviderConnectionPingChannels.live.create({
      executionProxyBaseUrl: config.executionProxyBaseUrl,
    }),
    ids: PrefixedModelProviderIdAdapter.create({ suffix: () => nanoid() }),
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherAdapter.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterAdapter.create({
      limiter: RedisModelProviderRateLimit.create({ redis: members.redis }),
    }),
    credentialProbe: probe,
    codexAccounts: new CodexAccountService(),
    // No trace read stack is composed at this seam. See the module docblock.
    spans: undefined,
  };
}
