import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger/server";
import { checkFlagEnvOverride } from "./envOverride";
import { FeatureFlagServiceMemory } from "./featureFlagService.memory";
import { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
import {
  FeatureFlagStorePostgres,
  getFeatureFlagStore,
} from "./featureFlagStore.postgres";
import type { FeatureFlagKey } from "./registry";
import { resolveFlagDefinition } from "./registry";
import type {
  FeatureFlagEvaluateOptions,
  FeatureFlagServiceInterface,
} from "./types";

/**
 * Main feature flag service.
 *
 * Resolution order depends on the flag's scope as declared in
 * `registry.ts`:
 *
 *  - SYSTEM (kill switches, pipeline toggles): env override -> postgres
 *    store -> registry default. PostHog is never called. This is the
 *    path that exists specifically so hot-path event-sourcing reactors
 *    don't generate per-tenant PostHog traffic.
 *
 *  - PRODUCT (UI features, A/B tests): env override -> postgres store
 *    (operator override) -> PostHog (when configured) -> registry
 *    default. Operator-set rows in /ops/feature-flags win so the Ops
 *    UI actually flips the flag — without that, both concrete legacy
 *    backends (PostHog and memory) swallow their own failures and
 *    return the registry default, so a postgres-only fallback after
 *    PostHog would be unreachable on the happy path. PostHog keeps
 *    user targeting and rollouts when no DB override exists.
 *
 *  - Unregistered keys: legacy path (env -> PostHog/memory). Kept for
 *    back-compat with flags that haven't been migrated into the
 *    registry yet.
 *
 * @see specs/ops/internal-feature-flags.feature for the contract
 * @see registry.ts for the list of registered flags
 */
export class FeatureFlagService implements FeatureFlagServiceInterface {
  private readonly legacyOverride?: FeatureFlagServiceInterface;
  private legacyInstance?: FeatureFlagServiceInterface;
  private readonly store: FeatureFlagStorePostgres;
  private readonly logger = createLogger("langwatch:feature-flag-service");

  constructor(
    deps: {
      legacy?: FeatureFlagServiceInterface;
      store?: FeatureFlagStorePostgres;
    } = {},
  ) {
    this.legacyOverride = deps.legacy;
    this.store = deps.store ?? getFeatureFlagStore();
  }

  /**
   * The legacy backend (PostHog when configured, memory otherwise) is built on
   * first use, not in the constructor. Constructing the PostHog backend starts
   * its background flag-definition poller, so a process that only ever
   * evaluates SYSTEM flags (workers, the event-sourcing pipeline) never builds
   * it and never polls PostHog. Only a PRODUCT/unregistered flag evaluation
   * reaches here.
   */
  private get legacy(): FeatureFlagServiceInterface {
    if (this.legacyOverride) return this.legacyOverride;
    this.legacyInstance ??= this.createLegacyService();
    return this.legacyInstance;
  }

  static create(): FeatureFlagService {
    return new FeatureFlagService();
  }

  /**
   * `flagKey` is constrained to the union of registered flag keys plus
   * the `es-*-killswitch` family template literal, so unregistered
   * string literals fail at compile time. Callers pass everything else
   * (distinctId, defaultValue, projectId/organizationId for PostHog
   * targeting, cacheTtlMs for hot-path TTL overrides) via the options
   * object.
   */
  async isEnabled(
    flagKey: FeatureFlagKey,
    opts: FeatureFlagEvaluateOptions,
  ): Promise<boolean> {
    const { distinctId, defaultValue = false } = opts;
    const definition = resolveFlagDefinition(flagKey);

    const envOverride = checkFlagEnvOverride(flagKey, definition?.legacyEnvVar);
    if (envOverride !== undefined) {
      return envOverride;
    }
    const forceOn = (process.env.FEATURE_FLAG_FORCE_ENABLE ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (forceOn.includes(flagKey)) {
      return true;
    }

    const storeCtx = {
      projectId: opts.projectId,
      organizationId: opts.organizationId,
    };

    if (definition?.scope === "SYSTEM") {
      const stored = await this.store.get(flagKey, storeCtx);
      if (stored !== null) return stored;
      return definition.defaultValue;
    }

    if (definition?.scope === "PRODUCT") {
      // Operator override via /ops/feature-flags wins. The store
      // evaluates per-org/per-project targeting rules first; if any
      // rule matches the calling context we use that result and never
      // touch PostHog. With no rule match and no row, fall through to
      // the legacy backend (PostHog when configured, memory otherwise).
      // Both legacy backends catch their own failures and return the
      // registry default, so checking the store first is also what
      // keeps the Ops UI usable during PostHog outages or quota caps.
      const stored = await this.store.get(flagKey, storeCtx);
      if (stored !== null) return stored;

      return await this.legacy.isEnabled(flagKey, {
        ...opts,
        distinctId,
        defaultValue: definition.defaultValue,
      });
    }

    // Unregistered keys reach the legacy backend for back-compat with
    // ad-hoc PostHog flags. The legacy memory/PostHog services widen
    // the param to `string` in their own implementations, so the
    // interface-level `FeatureFlagKey` constraint still gates new
    // callers without blocking runtime back-compat.
    return this.legacy.isEnabled(flagKey, { ...opts, defaultValue });
  }

  private createLegacyService(): FeatureFlagServiceInterface {
    if (env.POSTHOG_KEY) {
      this.logger.info("Using PostHog feature flag service for PRODUCT flags");
      return FeatureFlagServicePostHog.create();
    }
    return FeatureFlagServiceMemory.create();
  }

  getLegacyService(): FeatureFlagServiceInterface {
    return this.legacy;
  }

  getStore(): FeatureFlagStorePostgres {
    return this.store;
  }
}

export const featureFlagService = FeatureFlagService.create();
