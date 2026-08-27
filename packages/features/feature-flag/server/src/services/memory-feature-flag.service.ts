import {
  FeatureFlagService,
  frontendFeatureFlagMapSchema,
  FRONTEND_FEATURE_FLAGS,
  PUBLIC_ANONYMOUS_FEATURE_FLAGS,
  publicAnonymousFlagMapSchema,
  type ExperimentCatalogueEntry,
  type FeatureFlagEvaluateOptions,
  type FeatureFlagKey,
  type FeatureFlagRules,
  type FeatureFlagWrite,
  type FrontendFeatureFlag,
  type FrontendFeatureFlagMap,
  type OperatorFeatureFlagCatalogue,
  type PublicAnonymousFlagMap,
  type RuleEvaluationContext,
  type StoredFeatureFlag,
} from "@langwatch/feature-flag-contract";

/**
 * A complete contract fake backed by a map.
 *
 * Composition tests inject this in place of a database-backed graph so they
 * can drive a flag to a known value. It is reachable only through the
 * package's testing entry point; no process composes it.
 */
export class MemoryFeatureFlagService extends FeatureFlagService {
  private readonly flags = new Map<string, boolean>();

  static create(): MemoryFeatureFlagService {
    return new MemoryFeatureFlagService();
  }

  async isEnabled(flagKey: string, _options: FeatureFlagEvaluateOptions): Promise<boolean> {
    return this.flags.get(flagKey) ?? false;
  }

  async resolveExperimentCatalogue(): Promise<ExperimentCatalogueEntry[]> {
    return [];
  }

  async setUserExperimentEnrolment({
    flagKey,
    enrolled,
  }: {
    flagKey: FrontendFeatureFlag;
    enrolled: boolean;
  }): Promise<void> {
    this.setFlag(flagKey, enrolled);
  }

  async setExperimentTenantPolicy(): Promise<void> {
    return;
  }

  async resolveFrontendFlags(): Promise<FrontendFeatureFlagMap> {
    return frontendFeatureFlagMapSchema.parse(
      Object.fromEntries(
        FRONTEND_FEATURE_FLAGS.map((flag) => [flag, this.flags.get(flag) ?? false]),
      ),
    );
  }

  async resolvePublicAnonymousFlags(): Promise<PublicAnonymousFlagMap> {
    return publicAnonymousFlagMapSchema.parse(
      Object.fromEntries(
        PUBLIC_ANONYMOUS_FEATURE_FLAGS.map((flag) => [flag, this.flags.get(flag) ?? false]),
      ),
    );
  }

  async isEnabledFromStore(
    flagKey: FeatureFlagKey,
    _context: RuleEvaluationContext,
  ): Promise<boolean> {
    return this.flags.get(flagKey) ?? false;
  }

  async tryGetStoredValue(
    flagKey: string,
    _context: RuleEvaluationContext,
  ): Promise<boolean | null> {
    return this.flags.get(flagKey) ?? null;
  }

  async listStoredFlags(): Promise<StoredFeatureFlag[]> {
    return [];
  }

  async listOperatorCatalogue(): Promise<OperatorFeatureFlagCatalogue> {
    return { flags: [], families: [] };
  }

  async setEnabled({ key, enabled }: FeatureFlagWrite & { enabled: boolean }): Promise<void> {
    this.setFlag(key, enabled);
  }

  async setRules(_input: FeatureFlagWrite & { rules: FeatureFlagRules }): Promise<void> {
    return;
  }

  async clearStoredFlag({ key }: FeatureFlagWrite): Promise<void> {
    this.flags.delete(key);
  }

  /** Force a value for a key. Composition tests drive the fake with this. */
  setFlag(flagKey: string, enabled: boolean): void {
    this.flags.set(flagKey, enabled);
  }
}
