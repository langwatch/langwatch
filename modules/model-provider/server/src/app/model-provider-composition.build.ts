/**
 * Builds the {@link ModelProviderInfrastructure} this module used to receive
 * hand-composed (`apps/api/src/app/api-model-provider.composition.ts` and
 * `apps/api/src/features/model-provider/model-provider.composition.ts`, both
 * deleted by b383462d96). `ModelProviderApp.create` now builds it itself from
 * the one member it reads — `redis` — its one contract peer, and its own
 * config. `isSaas`, the egress fence and the system-provider environment all
 * travel as CONFIG rather than a `secrets` member of this module's own,
 * because `apps/api`'s own `ApiModelProviderConfigResolution` already
 * resolves every one of them (the deleted composition's `options.environment`
 * was the same whole-environment map, passed the same way).
 *
 * Two branches differ from the deleted composition on purpose, both recorded
 * here rather than guessed at silently:
 *
 *  - `managed` is always {@link UnmanagedModelProviderGatewayAdapter}. The
 *    deleted composition adapted the Enterprise managed-provider service onto
 *    this port from `apps/api`'s OWN composition, which is allowed to import
 *    Enterprise code; this module is core and may not. A deployment that
 *    needs LangWatch-managed provider credentials needs that seam restored at
 *    the composition root, not invented here — see the handoff.
 *  - `spans` is always `undefined`. The deleted composition carried the trace
 *    read stack through as an untyped peer (`ModelProviderPeers`), outside the
 *    dependency-token system this module now installs through. The one
 *    caller that reads it, `previewCostRuleMatchingSpans`, already refuses by
 *    name (`ModelCostPreviewUnavailableError`) rather than crashing, which is
 *    what makes leaving it unset here a narrowing rather than a crash.
 */
import { nanoid } from "nanoid";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
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
import { ModelProviderRateLimit } from "./model-provider.members.ts";
import type { ModelProviderAppConfig, ModelProviderInfrastructure } from "./model-provider.app.ts";

/**
 * The connection-test limiter's counter, over the process's own Redis: a
 * fixed window per key, the same arithmetic `redisRateLimiter` in
 * `@langwatch/infrastructure` uses. Kept here rather than reused from there
 * because this module's window and max travel PER CALL — an organization's
 * window and the deployment's global one, both from
 * {@link WindowedModelProviderConnectionRateLimiterAdapter} — rather than
 * fixed once at construction the way the generic member is.
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
  config: ModelProviderAppConfig;
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
