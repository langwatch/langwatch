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
import type { FeatureFlagOptions, FeatureFlagServiceInterface } from "./types";

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
  private readonly legacy: FeatureFlagServiceInterface;
  private readonly store: FeatureFlagStorePostgres;
  private readonly logger = createLogger("langwatch:feature-flag-service");

  constructor(
    deps: {
      legacy?: FeatureFlagServiceInterface;
      store?: FeatureFlagStorePostgres;
    } = {},
  ) {
    this.legacy = deps.legacy ?? this.createLegacyService();
    this.store = deps.store ?? getFeatureFlagStore();
  }

  static create(): FeatureFlagService {
    return new FeatureFlagService();
  }

  /**
   * Type-checked overload. `flagKey` is constrained to the union of
   * registered flag keys plus the `es-*-killswitch` family template
   * literal, so unregistered string literals fail at compile time.
   * Internally still accepts arbitrary strings via the implementation
   * signature so the legacy PostHog and memory backends keep working
   * with flags that pre-date the registry.
   */
  async isEnabled(
    flagKey: FeatureFlagKey,
    distinctId: string,
    defaultValue?: boolean,
    options?: FeatureFlagOptions,
  ): Promise<boolean>;
  async isEnabled(
    flagKey: string,
    distinctId: string,
    defaultValue = false,
    options?: FeatureFlagOptions,
  ): Promise<boolean> {
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

    if (definition?.scope === "SYSTEM") {
      const stored = await this.store.get(flagKey);
      if (stored !== null) return stored;
      return definition.defaultValue;
    }

    if (definition?.scope === "PRODUCT") {
      // Operator override via /ops/feature-flags wins. Both legacy
      // backends (PostHog and memory) catch their own failures and
      // return the registry default, so a try/catch around legacy
      // never falls through to postgres on its own. Checking the
      // store first keeps the Ops UI usable for self-hosted installs
      // and during PostHog outages without losing PostHog's user
      // targeting on flags that have no DB override.
      const stored = await this.store.get(flagKey);
      if (stored !== null) return stored;

      return await this.legacy.isEnabled(
        flagKey,
        distinctId,
        definition.defaultValue,
        options,
      );
    }

    return this.legacy.isEnabled(flagKey, distinctId, defaultValue, options);
  }

  private createLegacyService(): FeatureFlagServiceInterface {
    if (env.POSTHOG_KEY) {
      this.logger.info("Using PostHog feature flag service for PRODUCT flags");
      return FeatureFlagServicePostHog.create();
    }
    this.logger.warn(
      "POSTHOG_KEY not set; PRODUCT flags fall back to postgres/memory only.",
    );
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
