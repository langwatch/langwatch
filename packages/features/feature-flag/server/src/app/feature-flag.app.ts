import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  FEATURE_FLAG_REGISTRY,
  FeatureFlagApi,
  type FeatureFlagApi as FeatureFlagApiContract,
  type AuthenticatedExperimentTarget,
  type AuthenticatedFeatureFlagTargetInput,
  type ExperimentCatalogueEntry,
  type ExperimentEnrolmentForCaller,
  type ExperimentTenantPolicyForCaller,
  type ExperimentTenantScope,
  type FeatureFlagConfig,
  type FeatureFlagKey,
  type FeatureFlagReadForCaller,
  type FeatureFlagRules,
  type FeatureFlagTarget,
  type FeatureFlagTargetRequestForCaller,
  type FeatureFlagWrite,
  type FrontendFeatureFlagMap,
  type OperatorFeatureFlagCatalogue,
  type OrganizationFeatureFlagsForCaller,
  type PublicAnonymousFlagMap,
} from "@langwatch/feature-flag-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import type { FeatureFlagCachePort } from "../ports/feature-flag-cache.port.ts";
import type { FeatureFlagRepositories } from "../repositories/feature-flag.repositories.ts";
import { FeatureFlagService } from "../services/feature-flag.service.ts";
import { OrganizationCreatedAtCacheService } from "../services/organization-created-at-cache.service.ts";
import { CachedFeatureFlagRowAdapter } from "../adapters/cached.feature-flag-row.adapter.ts";

/**
 * What the process owns: the shared cache tier with its key prefix and TTL,
 * this deployment's environment overrides, and the clock.
 */
export type FeatureFlagInfrastructure = Readonly<{
  cache: FeatureFlagCachePort;
  config: FeatureFlagConfig;
  now?: () => number;
}>;

type FeatureFlagSetup = FeatureSetup<
  typeof FeatureFlagApp.dependencies,
  FeatureFlagInfrastructure,
  undefined,
  FeatureFlagRepositories
>;

export class FeatureFlagApp implements FeatureFlagApiContract {
  static readonly contract = FeatureFlagApi;
  static readonly dependencies = {
    permissions: AuthzApi,
    projects: ProjectApi,
    organizations: OrganizationApi,
  };

  readonly #flags: FeatureFlagService;
  readonly #permissions: AuthzApi;
  readonly #projects: ProjectApi;
  readonly #organizations: OrganizationApi;

  private constructor(
    flags: FeatureFlagService,
    dependencies: FeatureFlagSetup["dependencies"],
  ) {
    this.#flags = flags;
    this.#permissions = dependencies.permissions;
    this.#projects = dependencies.projects;
    this.#organizations = dependencies.organizations;
  }

  static create(setup: FeatureFlagSetup): FeatureFlagApp {
    const now = setup.infrastructure.now ?? (() => nowInstant().epochMilliseconds);
    const flags = FeatureFlagService.create({
      repository: setup.repositories.flags,
      experiments: setup.repositories.experiments,
      rows: CachedFeatureFlagRowAdapter.create({
        repository: setup.repositories.flags,
        cache: setup.infrastructure.cache,
        now,
      }),
      config: setup.infrastructure.config,
      registry: FEATURE_FLAG_REGISTRY,
      organizationAges: OrganizationCreatedAtCacheService.create({
        organizations: setup.dependencies.organizations,
      }),
    });

    return new FeatureFlagApp(flags, setup.dependencies);
  }

  isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean> {
    return this.#flags.isEnabled(flagKey, target);
  }

  resolveFrontendFlags(target: AuthenticatedExperimentTarget): Promise<FrontendFeatureFlagMap> {
    return this.#flags.resolveFrontendFlags(target);
  }

  resolvePublicAnonymousFlags(target: {
    kind: "anonymous";
    anonymousId: string;
  }): Promise<PublicAnonymousFlagMap> {
    return this.#flags.resolvePublicAnonymousFlags(target);
  }

  resolveExperimentCatalogue(
    target: Parameters<FeatureFlagService["resolveExperimentCatalogue"]>[0],
  ): Promise<ExperimentCatalogueEntry[]> {
    return this.#flags.resolveExperimentCatalogue(target);
  }

  setUserExperimentEnrolment(
    input: Parameters<FeatureFlagService["setUserExperimentEnrolment"]>[0],
  ): Promise<void> {
    return this.#flags.setUserExperimentEnrolment(input);
  }

  setExperimentTenantPolicy(
    input: Parameters<FeatureFlagService["setExperimentTenantPolicy"]>[0],
  ): Promise<void> {
    return this.#flags.setExperimentTenantPolicy(input);
  }

  listOperatorCatalogue(): Promise<OperatorFeatureFlagCatalogue> {
    return this.#flags.listOperatorCatalogue();
  }

  setEnabled(input: FeatureFlagWrite & { enabled: boolean }): Promise<void> {
    return this.#flags.setEnabled(input);
  }

  setRules(input: FeatureFlagWrite & { rules: FeatureFlagRules }): Promise<void> {
    return this.#flags.setRules(input);
  }

  clearStoredFlag(input: FeatureFlagWrite): Promise<void> {
    return this.#flags.clearStoredFlag(input);
  }

  async isEnabledForCaller(input: FeatureFlagReadForCaller): Promise<boolean> {
    const target = await this.authorizeLooseTarget(input);

    return this.#flags.isEnabled(input.flag, target);
  }

  /**
   * Evaluates only the organizations the caller belongs to, and omits the rest
   * rather than answering false for them: a present-and-false entry would turn
   * the answer into a membership oracle.
   */
  async isEnabledByOrganizationForCaller(
    input: OrganizationFeatureFlagsForCaller,
  ): Promise<Record<string, boolean>> {
    if (input.organizationIds.length === 0) return {};

    // One membership read for the whole list.
    const memberOf = await this.#organizations.memberOrganizationIds({
      userId: input.userId,
      organizationIds: input.organizationIds,
    });
    const entries = await Promise.all(
      memberOf.map(
        async (organizationId) =>
          [
            organizationId,
            await this.#flags.isEnabled(input.flag, {
              kind: "organization",
              userId: input.userId,
              organizationId,
            }),
          ] as const,
      ),
    );

    return Object.fromEntries(entries);
  }

  async resolveFrontendFlagsForCaller(
    input: FeatureFlagTargetRequestForCaller,
  ): Promise<FrontendFeatureFlagMap> {
    const target = await this.authorizeTarget(input.userId, input.target);

    return this.#flags.resolveFrontendFlags(target);
  }

  async listExperimentsForCaller(
    input: FeatureFlagTargetRequestForCaller,
  ): Promise<ExperimentCatalogueEntry[]> {
    const target = await this.authorizeTarget(input.userId, input.target);
    const entries = await this.#flags.resolveExperimentCatalogue(target);

    return this.stripUnauthorizedPolicies(input.userId, target, entries);
  }

  async setExperimentEnrolmentForCaller(input: ExperimentEnrolmentForCaller): Promise<void> {
    const target = await this.authorizeTarget(input.userId, input.target);

    await this.#flags.setUserExperimentEnrolment({
      flagKey: input.flag,
      target,
      enrolled: input.enrolled,
    });
  }

  async setExperimentTenantPolicyForCaller(
    input: ExperimentTenantPolicyForCaller,
  ): Promise<void> {
    await this.authorizeTenantPolicyChange(input.userId, input.scope);

    await this.#flags.setExperimentTenantPolicy({
      flagKey: input.flag,
      scope: input.scope,
      policy: input.policy,
      changedByUserId: input.userId,
    });
  }

  /**
   * The exact tenant target the caller asked for, authorized at its own tier.
   * A project is checked against the organization it actually belongs to, so a
   * caller cannot pair a project with an organization it is not in.
   */
  private async authorizeTarget(
    userId: string,
    target: AuthenticatedFeatureFlagTargetInput,
  ): Promise<AuthenticatedExperimentTarget> {
    if (target.kind === "user") {
      return { kind: "user", userId };
    }

    if (target.kind === "organization") {
      await this.authorizeOrganizationView(userId, target.organizationId);

      return { kind: "organization", userId, organizationId: target.organizationId };
    }

    await this.authorizeProjectView(userId, target.projectId);
    const organizationId = await this.#projects.getOrganizationId(target.projectId);
    if (organizationId !== target.organizationId) {
      throw this.projectOrganizationMismatch(target.projectId);
    }

    return { kind: "project", userId, projectId: target.projectId, organizationId };
  }

  /** The compatibility target shape: optional ids rather than a tagged union. */
  private async authorizeLooseTarget(
    input: FeatureFlagReadForCaller,
  ): Promise<AuthenticatedExperimentTarget> {
    if (input.projectId) {
      await this.authorizeProjectView(input.userId, input.projectId);
      const organizationId = await this.#projects.getOrganizationId(input.projectId);
      if (input.organizationId && organizationId !== input.organizationId) {
        throw this.projectOrganizationMismatch(input.projectId);
      }

      return { kind: "project", userId: input.userId, projectId: input.projectId, organizationId };
    }

    if (input.organizationId) {
      await this.authorizeOrganizationView(input.userId, input.organizationId);

      return { kind: "organization", userId: input.userId, organizationId: input.organizationId };
    }

    return { kind: "user", userId: input.userId };
  }

  private async authorizeProjectView(userId: string, projectId: string): Promise<void> {
    const permitted = await this.#permissions.hasPermission({
      userId,
      permission: "project:view",
      projectId,
    });
    if (!permitted) {
      throw new PermissionDeniedError({
        permission: "project:view",
        scope: { type: "project", id: projectId },
        denialReason: "no-membership",
      });
    }
  }

  private async authorizeOrganizationView(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const permitted = await this.#permissions.hasPermission({
      userId,
      permission: "organization:view",
      organizationId,
    });
    if (!permitted) {
      throw new PermissionDeniedError({
        permission: "organization:view",
        scope: { type: "organization", id: organizationId },
        denialReason: "no-membership",
      });
    }
  }

  private projectOrganizationMismatch(projectId: string): PermissionDeniedError {
    return new PermissionDeniedError({
      permission: "project:view",
      scope: { type: "project", id: projectId },
      denialReason: "no-membership",
    });
  }

  /** Tenant policies are manager data; a viewer sees the entry without them. */
  private async stripUnauthorizedPolicies(
    userId: string,
    target: AuthenticatedExperimentTarget,
    entries: ExperimentCatalogueEntry[],
  ): Promise<ExperimentCatalogueEntry[]> {
    const canManageProject =
      target.kind === "project" &&
      (await this.#permissions.hasPermission({
        userId,
        permission: "featureFlags:manageExperiments",
        projectId: target.projectId,
      }));
    const canManageOrganization =
      (target.kind === "project" || target.kind === "organization") &&
      (await this.#permissions.hasPermission({
        userId,
        permission: "featureFlags:manageExperiments",
        organizationId: target.organizationId,
      }));

    return entries.map((entry) => {
      const { projectPolicy, organizationPolicy, ...viewerEntry } = entry;

      return {
        ...viewerEntry,
        ...(canManageProject && projectPolicy ? { projectPolicy } : {}),
        ...(canManageOrganization && organizationPolicy ? { organizationPolicy } : {}),
      };
    });
  }

  private async authorizeTenantPolicyChange(
    userId: string,
    scope: ExperimentTenantScope,
  ): Promise<void> {
    const permitted = await this.#permissions.hasPermission({
      userId,
      permission: "featureFlags:manageExperiments",
      ...(scope.kind === "project"
        ? { projectId: scope.projectId }
        : { organizationId: scope.organizationId }),
    });
    if (!permitted) {
      throw new PermissionDeniedError({
        permission: "featureFlags:manageExperiments",
        scope:
          scope.kind === "project"
            ? { type: "project", id: scope.projectId }
            : { type: "organization", id: scope.organizationId },
        denialReason: "no-membership",
      });
    }
  }
}
