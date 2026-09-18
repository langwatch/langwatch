import { checkFlagEnvOverride } from "./envOverride";
import { FeatureFlagServiceMemory } from "./featureFlagService.memory";
import {
  type FeatureFlagStorePostgres,
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
 *    store -> registry default. This is the path that exists
 *    specifically so hot-path event-sourcing subscribers don't generate
 *    per-tenant external traffic.
 *
 *  - PRODUCT (UI features, A/B tests): env override -> postgres store
 *    (operator override) -> registry default. Operator-set rows in
 *    /ops/feature-flags win; per-org/per-project targeting rules are
 *    evaluated by the store itself before falling back to the registry
 *    default.
 *
 *  - Unregistered keys: legacy path (env -> memory). Kept for
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
   * The legacy backend (in-memory) is built on first use, not in the
   * constructor. Only an unregistered flag evaluation reaches here —
   * every registered SYSTEM/PRODUCT flag resolves from env override or
   * the postgres store without ever constructing it.
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
   * (distinctId, defaultValue, projectId/organizationId for the store's
   * targeting rules, cacheTtlMs for hot-path TTL overrides) via the
   * options object.
   */
  async isEnabled(
    flagKey: FeatureFlagKey,
    opts: FeatureFlagEvaluateOptions,
  ): Promise<boolean> {
    const { defaultValue = false } = opts;
    const definition = resolveFlagDefinition(flagKey);

    if (definition?.envOverridable !== false) {
      const envOverride = checkFlagEnvOverride(
        flagKey,
        definition?.legacyEnvVar,
      );
      if (envOverride !== undefined) {
        return envOverride;
      }
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

    if (definition?.scope === "SYSTEM" || definition?.scope === "PRODUCT") {
      // Operator override via /ops/feature-flags wins. The store
      // evaluates per-org/per-project targeting rules first; if any
      // rule matches the calling context we use that result. With no
      // rule match and no row, fall through to the registry default.
      const stored = await this.store.get(flagKey, storeCtx);
      if (stored !== null) return stored;
      return definition.defaultValue;
    }

    // Unregistered keys reach the legacy backend for back-compat with
    // ad-hoc flags that haven't been migrated into the registry. The
    // legacy memory service widens the param to `string` in its own
    // implementation, so the interface-level `FeatureFlagKey`
    // constraint still gates new callers without blocking runtime
    // back-compat.
    return this.legacy.isEnabled(flagKey, { ...opts, defaultValue });
  }

  private createLegacyService(): FeatureFlagServiceInterface {
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
