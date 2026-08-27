import {
  isExperimentVisibleToTarget,
  evaluateRules,
  FeatureFlagService as FeatureFlagServiceContract,
  ruleContextForTarget,
  resolveExperimentDecision,
  resolveEffectiveForListing,
  type ExperimentCatalogueEntry,
  type ExperimentEvaluationTarget,
  type ExperimentTenantPolicy,
  type ExperimentTenantScope,
  type AuthenticatedExperimentTarget,
  type FeatureFlagConfig,
  type FeatureFlagKey,
  type FeatureFlagRegistry,
  type PublicAnonymousFlagMap,
  type FeatureFlagRules,
  type FeatureFlagWrite,
  type FrontendFeatureFlag,
  type FrontendFeatureFlagMap,
  type OperatorFeatureFlagCatalogue,
  type RuleEvaluationContext,
  type FeatureFlagTarget,
  FeatureFlagExperimentUnavailableError,
  UnknownFeatureFlagError,
  UnknownFeatureFlagExperimentError,
} from "@langwatch/feature-flag-contract";
import type {
  ExperimentSubject,
  FeatureFlagExperimentRepository,
} from "../repositories/feature-flag-experiment-setting.repository";
import type { FeatureFlagRepository } from "../repositories/feature-flag.repository";
import type { FeatureFlagRowStore } from "../stores/feature-flag-row.store";

export class FeatureFlagService extends FeatureFlagServiceContract {
  private constructor(
    private readonly rows: FeatureFlagRowStore,
    private readonly repository: FeatureFlagRepository,
    private readonly experiments: FeatureFlagExperimentRepository,
    private readonly config: FeatureFlagConfig,
    private readonly registry: FeatureFlagRegistry,
  ) {
    super();
  }

  static create(options: {
    rows: FeatureFlagRowStore;
    repository: FeatureFlagRepository;
    experiments: FeatureFlagExperimentRepository;
    config: FeatureFlagConfig;
    registry: FeatureFlagRegistry;
  }): FeatureFlagService {
    return new FeatureFlagService(
      options.rows,
      options.repository,
      options.experiments,
      options.config,
      options.registry,
    );
  }

  async isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean> {
    const definition = this.registry.resolve(flagKey);
    if (!definition) {
      throw new UnknownFeatureFlagError(flagKey);
    }

    const override = this.config.overrides.get(flagKey);
    if (override !== undefined) {
      return override;
    }

    if (this.config.forceEnabled.has(flagKey)) {
      return true;
    }

    const stored = await this.tryResolveStoredValue(flagKey, ruleContextForTarget(target));
    if (stored !== null) {
      return stored;
    }

    return definition.defaultValue;
  }

  async resolveFrontendFlags(
    target: AuthenticatedExperimentTarget,
  ): Promise<FrontendFeatureFlagMap> {
    const availability = await Promise.all(
      this.registry.browserVisibleKeys.map(
        async (flag) => [flag, await this.isEnabled(flag, target)] as const,
      ),
    );
    const decided = await this.decideExperiments({
      target,
      availability: new Map(availability),
    });

    return this.toFlagMap(
      availability.map(([flag, available]) => [flag, decided.get(flag) ?? available]),
    );
  }

  async resolvePublicAnonymousFlags(target: {
    kind: "anonymous";
    anonymousId: string;
  }): Promise<PublicAnonymousFlagMap> {
    const resolved = await Promise.all(
      this.registry.publicAnonymousKeys.map(
        async (flag) => [flag, await this.isEnabled(flag, target)] as const,
      ),
    );

    return this.registry.publicAnonymousMapSchema.parse(Object.fromEntries(resolved));
  }

  /** Every browser-visible key, present exactly once, parsed not asserted. */
  private toFlagMap(
    entries: readonly (readonly [FrontendFeatureFlag, boolean])[],
  ): FrontendFeatureFlagMap {
    const resolved = new Map(entries);

    return this.registry.frontendMapSchema.parse(
      Object.fromEntries(
        this.registry.browserVisibleKeys.map((flag) => [flag, resolved.get(flag) ?? false]),
      ),
    );
  }

  async resolveExperimentCatalogue(
    target: ExperimentEvaluationTarget,
  ): Promise<ExperimentCatalogueEntry[]> {
    const visible = this.registry
      .experiments()
      .filter(({ experiment }) => isExperimentVisibleToTarget({ experiment, target }));
    if (visible.length === 0) {
      return [];
    }

    const settings = await this.readSettings({
      target,
      flagKeys: visible.map(({ key }) => key),
    });

    const entries = await Promise.all(
      visible.map(async ({ key, experiment }) => {
        const available = await this.isEnabled(key, target);
        const projectPolicy = settings.policyFor("PROJECT", key);
        const organizationPolicy = settings.policyFor("ORGANIZATION", key);
        const { enabled, decision } = resolveExperimentDecision({
          experiment,
          target,
          available,
          projectPolicy,
          organizationPolicy,
          userEnrolled: settings.enrolled(key),
        });

        // Registry metadata alone must not announce an unreleased
        // experiment, so an unavailable one is omitted rather than listed
        // as present-and-off. A tenant-disabled experiment is still
        // available, so it stays visible for the owner to re-enable.
        if (!available) {
          return undefined;
        }

        return {
          key,
          title: experiment.title,
          summary: experiment.summary,
          catalogueVersion: experiment.catalogueVersion,
          enabled,
          decision,
          userEnrolled: settings.enrolled(key),
          ...(target.kind === "project" ? { projectPolicy } : {}),
          ...(target.kind === "project" || target.kind === "organization"
            ? { organizationPolicy }
            : {}),
        };
      }),
    );

    return entries.filter((entry): entry is ExperimentCatalogueEntry => !!entry);
  }

  async setUserExperimentEnrolment({
    flagKey,
    target,
    enrolled,
  }: {
    flagKey: FrontendFeatureFlag;
    target: AuthenticatedExperimentTarget;
    enrolled: boolean;
  }): Promise<void> {
    this.assertExperiment(flagKey);

    // Leaving removes the row rather than storing a negative, so a later
    // tenant `enabled` still reaches this person.
    if (!enrolled) {
      await this.experiments.remove({
        flagKey,
        subjectType: "USER",
        subjectId: target.userId,
      });

      return;
    }

    // Joining is only possible for someone the experiment is actually open
    // to, so an enrolment row can never exist for a person outside the
    // rollout.
    const available = await this.isEnabled(flagKey, target);
    if (!available) {
      throw new FeatureFlagExperimentUnavailableError();
    }

    await this.experiments.upsert({
      flagKey,
      subjectType: "USER",
      subjectId: target.userId,
      enabled: true,
      changedByUserId: target.userId,
    });
  }

  private assertExperiment(flagKey: string): void {
    if (!this.registry.resolve(flagKey)?.experiment) {
      throw new UnknownFeatureFlagExperimentError();
    }
  }

  async setExperimentTenantPolicy({
    flagKey,
    scope,
    policy,
    changedByUserId,
  }: {
    flagKey: FrontendFeatureFlag;
    scope: ExperimentTenantScope;
    policy: ExperimentTenantPolicy;
    changedByUserId: string;
  }): Promise<void> {
    this.assertExperiment(flagKey);

    const subject: ExperimentSubject =
      scope.kind === "project"
        ? { subjectType: "PROJECT", subjectId: scope.projectId }
        : { subjectType: "ORGANIZATION", subjectId: scope.organizationId };

    if (policy === "inherit") {
      await this.experiments.remove({ flagKey, ...subject });

      return;
    }

    await this.experiments.upsert({
      flagKey,
      ...subject,
      enabled: policy === "enabled",
      changedByUserId,
    });
  }

  private async decideExperiments({
    target,
    availability,
  }: {
    target: ExperimentEvaluationTarget;
    availability: Map<string, boolean>;
  }): Promise<Map<string, boolean>> {
    const visible = this.registry
      .experiments()
      .filter(({ experiment }) => isExperimentVisibleToTarget({ experiment, target }));
    // An experiment this target cannot see reads as off rather than falling
    // through to its raw availability.
    const decided = new Map<string, boolean>();
    for (const { key } of this.registry.experiments()) {
      if (!visible.some((candidate) => candidate.key === key)) {
        decided.set(key, false);
      }
    }

    if (visible.length === 0) {
      return decided;
    }

    const settings = await this.readSettings({
      target,
      flagKeys: visible.map(({ key }) => key),
    });
    for (const { key, experiment } of visible) {
      const { enabled } = resolveExperimentDecision({
        experiment,
        target,
        available: availability.get(key) ?? false,
        projectPolicy: settings.policyFor("PROJECT", key),
        organizationPolicy: settings.policyFor("ORGANIZATION", key),
        userEnrolled: settings.enrolled(key),
      });
      decided.set(key, enabled);
    }

    return decided;
  }

  private async readSettings({
    target,
    flagKeys,
  }: {
    target: ExperimentEvaluationTarget;
    flagKeys: readonly string[];
  }): Promise<{
    policyFor: (subjectType: "PROJECT" | "ORGANIZATION", flagKey: string) => ExperimentTenantPolicy;
    enrolled: (flagKey: string) => boolean;
  }> {
    const subjects: ExperimentSubject[] = [];
    if (target.kind !== "anonymous") {
      subjects.push({ subjectType: "USER", subjectId: target.userId });
    }

    if (target.kind === "project") {
      subjects.push({ subjectType: "PROJECT", subjectId: target.projectId });
    }

    if (target.kind === "project" || target.kind === "organization") {
      subjects.push({ subjectType: "ORGANIZATION", subjectId: target.organizationId });
    }

    const rows = await this.experiments.findForSubjects({ flagKeys, subjects });
    const bySubject = new Map(
      rows.map((row) => [`${row.subjectType} ${row.flagKey}`, row.enabled]),
    );

    return {
      policyFor: (subjectType, flagKey) => {
        const stored = bySubject.get(`${subjectType} ${flagKey}`);
        if (stored === undefined) {
          return "inherit";
        }

        return stored ? "enabled" : "disabled";
      },
      enrolled: (flagKey) => bySubject.get(`USER ${flagKey}`) === true,
    };
  }

  private async tryResolveStoredValue(
    flagKey: string,
    context: RuleEvaluationContext = {},
  ): Promise<boolean | null> {
    const row = await this.rows.tryGetRow(flagKey);
    if (row === null) {
      return null;
    }

    const ruleHit = evaluateRules(row.rules, context, flagKey);

    return ruleHit ?? row.enabled;
  }

  async listOperatorCatalogue(): Promise<OperatorFeatureFlagCatalogue> {
    const stored = await this.repository.findAll();
    const registeredKeys = new Set(this.registry.definitions.map(({ key }) => key));
    const flags = this.registry.definitions.map((definition) => {
      const row = stored.find(({ key }) => key === definition.key);
      const envOverride = this.config.overrides.get(definition.key) ?? null;

      return {
        key: definition.key,
        scope: definition.scope,
        defaultValue: definition.defaultValue,
        description: definition.description,
        family: definition.family ?? null,
        storedValue: row?.enabled ?? null,
        rules: row?.rules ?? [],
        envOverride,
        effective: resolveEffectiveForListing({
          envOverride,
          rules: row?.rules ?? [],
          rowEnabled: row?.enabled ?? null,
          registryDefault: definition.defaultValue,
        }),
        lastEditedBy: row?.lastEditedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
    const orphaned = stored
      .filter(({ key }) => !registeredKeys.has(key))
      .map((row) => ({
        key: row.key,
        scope: "SYSTEM" as const,
        defaultValue: false,
        description: "Orphaned postgres flag row (no longer registered).",
        family: null,
        storedValue: row.enabled,
        rules: row.rules,
        envOverride: null,
        effective: resolveEffectiveForListing({
          envOverride: null,
          rules: row.rules,
          rowEnabled: row.enabled,
          registryDefault: false,
        }),
        lastEditedBy: row.lastEditedBy,
        updatedAt: row.updatedAt,
      }));

    return {
      flags: [...flags, ...orphaned],
      families: this.registry.families.map((family) => ({
        family: family.family,
        keyPrefix: family.keyPrefix,
        scope: family.scope,
        defaultValue: family.defaultValue,
        description: family.description,
      })),
    };
  }

  async setEnabled({
    key,
    enabled,
    lastEditedBy,
  }: FeatureFlagWrite & { enabled: boolean }): Promise<void> {
    if (!this.registry.resolve(key)) {
      throw new UnknownFeatureFlagError(key);
    }

    await this.repository.upsertEnabled({ key, enabled, lastEditedBy });
    await this.rows.invalidate(key);
  }

  async setRules({
    key,
    rules,
    lastEditedBy,
  }: FeatureFlagWrite & { rules: FeatureFlagRules }): Promise<void> {
    if (!this.registry.resolve(key)) {
      throw new UnknownFeatureFlagError(key);
    }

    await this.repository.upsertRules({
      key,
      rules,
      seedEnabled: this.registry.resolve(key)?.defaultValue ?? false,
      lastEditedBy,
    });
    await this.rows.invalidate(key);
  }

  async clearStoredFlag({ key }: FeatureFlagWrite): Promise<void> {
    await this.repository.deleteByKey(key);
    await this.rows.invalidate(key);
  }
}
