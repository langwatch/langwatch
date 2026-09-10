/**
 * Who may change a project's retention, and to what. Every decision here is a refusal or
 * nothing: the service either returns, or it throws the answer the settings page has always
 * shown.
 */
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  PAID_RETENTION_PRESET_DAYS,
  RetentionDisableForbiddenError,
  RetentionLengthBelowPlanMinimumError,
  RetentionLengthNotOnPlanError,
  RetentionNotOnPlanError,
  ScopeTargetNotFoundError,
  ScopeWriteForbiddenError,
} from "@langwatch/data-retention-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type {
  DataRetentionPlan,
  DataRetentionPlanPort,
} from "../ports/data-retention-plan.port.ts";
import type { RetentionPermissionsService } from "./retention-permissions.service.ts";

/** The caller a gate is decided for, resolved once per request by the app. */
export type RetentionActor = Readonly<{ userId: string; email: string | null }>;

export type DataRetentionPolicyServiceOptions = Readonly<{
  directory: DataRetentionDirectoryReader;
  permissions: RetentionPermissionsService;
  plans: DataRetentionPlanPort;
  /** The platform-operator allow-list, which is an address list rather than a grant. */
  administrators: Pick<UserApi, "isAdmin">;
}>;

/**
 * Which retention values a plan tier may persist.
 */
type RetentionValueRule =
  | { kind: "fixed"; presetDays: readonly number[] }
  | { kind: "uncapped"; customMin: number };

function ruleForPlan(plan: DataRetentionPlan): RetentionValueRule {
  if (plan.uncapped) {
    return { kind: "uncapped", customMin: ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS };
  }

  return { kind: "fixed", presetDays: PAID_RETENTION_PRESET_DAYS };
}

export class DataRetentionPolicyService {
  /**
   * Permission required to write a retention override at a given tier.
   */
  static requiredWritePermission(
    scopeType: ScopeAssignment["scopeType"],
  ): "organization:manage" | "team:manage" | "project:update" {
    if (scopeType === "ORGANIZATION") {
      return "organization:manage";
    }

    if (scopeType === "TEAM") {
      return "team:manage";
    }

    return "project:update";
  }

  /**
   * Refuses a free plan by name. Pure — the single source of the free-tier
   * gate, over an already-resolved plan, so a caller that has the plan in hand
   * doesn't refetch it.
   */
  static assertPlanConfigurable(plan: DataRetentionPlan): void {
    if (!plan.free) {
      return;
    }

    throw new RetentionNotOnPlanError();
  }

  /**
   * Refuses by name when `plan` may not persist `retentionDays`.
   */
  static assertPlanAllowsRetentionValue(plan: DataRetentionPlan, retentionDays: number): void {
    if (retentionDays === INDEFINITE_RETENTION_DAYS) {
      return;
    }

    if (plan.free) {
      return;
    }

    const rule = ruleForPlan(plan);

    if (rule.kind === "uncapped") {
      // The paid short presets are the only values allowed below the enterprise
      // custom floor. Everything else must clear the floor; whole-week alignment
      // is already enforced by the contract's own day schema.
      if ((PAID_RETENTION_PRESET_DAYS as readonly number[]).includes(retentionDays)) {
        return;
      }

      if (retentionDays < rule.customMin) {
        throw new RetentionLengthBelowPlanMinimumError(rule.customMin);
      }

      return;
    }

    if (!rule.presetDays.includes(retentionDays)) {
      throw new RetentionLengthNotOnPlanError();
    }
  }

  static create(options: DataRetentionPolicyServiceOptions): DataRetentionPolicyService {
    return new DataRetentionPolicyService(options);
  }

  private constructor(private readonly options: DataRetentionPolicyServiceOptions) {}

  /**
   * Whether the organization's plan unlocks per-scope overrides at all. Read
   * rather than enforced: the snapshot renders the controls off this, and the
   * gates below are what actually refuse.
   */
  async canConfigureRetention(input: {
    organizationId: string | null;
    actor: RetentionActor;
  }): Promise<boolean> {
    if (!input.organizationId) {
      return false;
    }

    const plan = await this.options.plans.getPlan({
      organizationId: input.organizationId,
      userId: input.actor.userId,
    });

    return !plan.free;
  }

  /**
   * Refuses a caller who may not write a retention override at `scope`. The
   * required permission matches what the read snapshot uses to decide the scope
   * is writable, so the UI never offers a scope the save will reject.
   */
  async assertCanWriteScope(input: {
    actor: RetentionActor;
    scope: ScopeAssignment;
  }): Promise<void> {
    if (await this.canWriteScope(input)) {
      return;
    }

    throw new ScopeWriteForbiddenError(
      input.scope.scopeType,
      DataRetentionPolicyService.requiredWritePermission(input.scope.scopeType),
    );
  }

  /**
   * Disabling retention (keep data indefinitely, exempt from TTL deletion) is a
   * platform-level capability, NOT a customer tier. The UI hides the option
   * from everyone else; this is the matching server-side enforcement.
   */
  assertCanDisableRetention(input: { actor: RetentionActor }): void {
    if (this.options.administrators.isAdmin({ email: input.actor.email })) {
      return;
    }

    throw new RetentionDisableForbiddenError();
  }

  /**
   * Plan-gate a scope-targeted mutation against the organization that owns the SCOPE — never
   * against the caller-supplied project id.
   */
  async assertPlanForScope(input: {
    actor: RetentionActor;
    scope: ScopeAssignment;
  }): Promise<void> {
    const { plan } = await this.resolveScopePlan(input);
    DataRetentionPolicyService.assertPlanConfigurable(plan);
  }

  /** Plan-gate a project-targeted mutation via the project's owning organization. */
  async assertPlanForProject(input: { actor: RetentionActor; projectId: string }): Promise<void> {
    const lineage = await this.options.directory.findProjectLineage({
      projectId: input.projectId,
    });
    const organizationId = lineage?.organizationId;
    if (!organizationId) {
      throw new ProjectNotFoundError("That project is no longer in an organization.");
    }

    const plan = await this.options.plans.getPlan({
      organizationId,
      userId: input.actor.userId,
    });
    DataRetentionPolicyService.assertPlanConfigurable(plan);
  }

  /**
   * The full write gate for a NEW value: resolve the scope's owning-organization plan ONCE,
   * then apply the free gate and the value gate to it.
   */
  async assertWriteAllowed(input: {
    actor: RetentionActor;
    scope: ScopeAssignment;
    retentionDays: number;
  }): Promise<void> {
    const { plan } = await this.resolveScopePlan(input);
    DataRetentionPolicyService.assertPlanConfigurable(plan);
    DataRetentionPolicyService.assertPlanAllowsRetentionValue(plan, input.retentionDays);
  }

  private async canWriteScope(input: {
    actor: RetentionActor;
    scope: ScopeAssignment;
  }): Promise<boolean> {
    const userId = input.actor.userId;
    const { scopeType, scopeId } = input.scope;
    if (scopeType === "ORGANIZATION") {
      return await this.options.permissions.canManageOrganization({
        userId,
        organizationId: scopeId,
      });
    }

    const organizationId = await this.options.directory.findScopeOrganizationId({
      scope: input.scope,
    });
    if (!organizationId) {
      return false;
    }

    if (scopeType === "TEAM") {
      const decided = await this.options.permissions.canManageTeams({
        userId,
        organizationId,
        teamIds: [scopeId],
      });

      return decided.get(scopeId) === true;
    }

    const decided = await this.options.permissions.canUpdateProjects({
      userId,
      organizationId,
      projectIds: [scopeId],
    });

    return decided.get(scopeId) === true;
  }

  /**
   * Resolve a scope to its owning organization's plan in a single pass — the
   * one place that touches the directory and the plan for a scope-targeted
   * write, so a write never resolves the organization or fetches the plan twice.
   */
  private async resolveScopePlan(input: {
    actor: RetentionActor;
    scope: ScopeAssignment;
  }): Promise<{ organizationId: string; plan: DataRetentionPlan }> {
    const organizationId = await this.options.directory.findScopeOrganizationId({
      scope: input.scope,
    });
    if (!organizationId) {
      throw new ScopeTargetNotFoundError();
    }

    const plan = await this.options.plans.getPlan({
      organizationId,
      userId: input.actor.userId,
    });

    return { organizationId, plan };
  }
}
