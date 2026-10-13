/**
 * Who may change a project's retention, and to what. Every decision here is a refusal or
 * nothing: the service either returns, or it throws the answer the settings page has always
 * shown.
 */
import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  PAID_RETENTION_PRESET_DAYS,
  RetentionDisableForbiddenError,
  RetentionLengthBelowPlanMinimumError,
  RetentionLengthNotOnPlanError,
  RetentionNotOnPlanError,
} from "@langwatch/data-retention-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { RetentionPermissionsService } from "./retention-permissions.service.ts";
import type { DataRetentionPlan, RetentionPlanService } from "./retention-plan.service.ts";

/** The caller a gate is decided for, resolved once per request by the app. */
export type RetentionActor = Readonly<{ userId: string; email: string | null }>;

type DataRetentionPolicyServiceOptions = Readonly<{
  directory: DataRetentionDirectoryReader;
  permissions: RetentionPermissionsService;
  plans: Pick<RetentionPlanService, "getPlan">;
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
   * Disabling retention (keep data indefinitely, exempt from TTL deletion) is a
   * platform-level capability, NOT a customer tier. The UI hides the option
   * from everyone else; this is the matching server-side enforcement.
   */
  async assertCanDisableRetention(input: { actor: RetentionActor }): Promise<void> {
    if (await this.options.permissions.isPlatformOperator({ userId: input.actor.userId })) {
      return;
    }

    throw new RetentionDisableForbiddenError();
  }

  /**
   * Plan-gate a scope-targeted mutation against the organization the caller named, which
   * the retention service has already proved holds the scope.
   */
  async assertPlanForScope(input: {
    actor: RetentionActor;
    organizationId: string;
  }): Promise<void> {
    const plan = await this.options.plans.getPlan({
      organizationId: input.organizationId,
      userId: input.actor.userId,
    });
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

  /** The full write gate for a NEW value: the plan once, then the free gate and the value gate. */
  async assertWriteAllowed(input: {
    actor: RetentionActor;
    organizationId: string;
    retentionDays: number;
  }): Promise<void> {
    const plan = await this.options.plans.getPlan({
      organizationId: input.organizationId,
      userId: input.actor.userId,
    });
    DataRetentionPolicyService.assertPlanConfigurable(plan);
    DataRetentionPolicyService.assertPlanAllowsRetentionValue(plan, input.retentionDays);
  }
}
