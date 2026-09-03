import {
  isExperimentVisibleToTarget,
  evaluateRules,
  FeatureFlagService as FeatureFlagServiceContract,
  ruleContextForTarget,
  resolveExperimentDecision,
  resolveEffectiveForListing,
  readNeedsOrganizationAge,
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

/**
 * An organization's creation date never changes, so this window bounds how
 * many rows a process holds rather than how stale an answer may be. It is
 * deliberately longer than the flag row's own window: an operator editing an
 * age rule must see the new rule within a cache window, but the dates it
 * compares against are immutable history.
 */
const ORGANIZATION_CREATED_AT_TTL_MS = 10 * 60_000;
const ORGANIZATION_CREATED_AT_MAX_KEYS = 10_000;

export class FeatureFlagService extends FeatureFlagServiceContract {
  // Creation dates of organizations named by an age rule, keyed by
  // organization rather than by flag, and outliving a flag-row cache window.
  private readonly organizationCreatedAt = new Map<
    string,
    { createdAt: Date | null; expiresAt: number }
  >();

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

    const ruleHit = evaluateRules(
      row.rules,
      await this.withOrganizationAge(row.rules, context, flagKey),
      flagKey,
    );

    return ruleHit ?? row.enabled;
  }

  /**
   * Fills in `organizationCreatedAt` for a read whose flag carries a "new
   * organizations" rule, so no caller has to know the rule exists.
   *
   * Every flag read would otherwise have to carry the creation date, which
   * means every call site — the per-event kill-switch path included — paying
   * for a lookup no rule asks for. It is resolved here instead, only when
   * this flag's own rules name it, and cached per organization. A flag with
   * no age rule reads exactly what it read before.
   */
  private async withOrganizationAge(
    rules: FeatureFlagRules,
    context: RuleEvaluationContext,
    flagKey: string,
  ): Promise<RuleEvaluationContext> {
    if (context.organizationCreatedAt !== undefined) return context;
    if (!context.organizationId) return context;
    if (!readNeedsOrganizationAge({ rules, ctx: context, flagKey })) return context;

    return {
      ...context,
      organizationCreatedAt: await this.getOrganizationCreatedAt(context.organizationId),
    };
  }

  /**
   * Reads an organization's creation date, memoised per process. A failed
   * read resolves to null, which matches no age rule — the same fail-closed
   * choice the matcher makes for an unknown date, so a database blip cannot
   * hand a rollout to organizations it excludes.
   */
  private async getOrganizationCreatedAt(organizationId: string): Promise<Date | null> {
    const now = Date.now();
    const cached = this.organizationCreatedAt.get(organizationId);
    if (cached && cached.expiresAt > now) return cached.createdAt;

    try {
      const createdAt = await this.repository.tryFindOrganizationCreatedAt(organizationId);
      this.rememberOrganizationCreatedAt({ organizationId, createdAt, now });
      return createdAt;
    } catch {
      // Deliberately not cached: a failed read is a blip, not an answer, and
      // caching it would extend one bad minute across the whole window.
      return null;
    }
  }

  private rememberOrganizationCreatedAt({
    organizationId,
    createdAt,
    now,
  }: {
    organizationId: string;
    createdAt: Date | null;
    now: number;
  }): void {
    if (this.organizationCreatedAt.size >= ORGANIZATION_CREATED_AT_MAX_KEYS) {
      this.evictOrganizationCreatedAt(now);
    }
    this.organizationCreatedAt.set(organizationId, {
      createdAt,
      expiresAt: now + ORGANIZATION_CREATED_AT_TTL_MS,
    });
  }

  /**
   * A Map iterates in insertion order, so the fallback drops the oldest entry
   * rather than the least recently used one. That is the intended trade:
   * tracking recency would mean writing to the map on every read, and the
   * entry being protected is a date that is only worth one query anyway.
   */
  private evictOrganizationCreatedAt(now: number): void {
    for (const [id, entry] of this.organizationCreatedAt) {
      if (entry.expiresAt <= now) this.organizationCreatedAt.delete(id);
    }
    if (this.organizationCreatedAt.size < ORGANIZATION_CREATED_AT_MAX_KEYS) return;
    const oldest = this.organizationCreatedAt.keys().next();
    if (!oldest.done) this.organizationCreatedAt.delete(oldest.value);
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
