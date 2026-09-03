/**
 * Who may change a project's retention, and to what.
 *
 * Every decision here is a refusal or nothing: the service either returns, or
 * it throws the answer the settings page has always shown. It is the WRITE
 * half of the pair whose read half is {@link DataRetentionSnapshotService}, and
 * the two must agree — the snapshot advertises a scope as writable using
 * exactly the permissions this refuses on, so the chip picker can never offer a
 * scope the save then rejects.
 *
 * The refusals stay `TRPCError` with the codes the platform application
 * answered (`FORBIDDEN`, `NOT_FOUND`). They are the customer-visible copy this
 * surface already had; turning them into new handled codes needs an entry in a
 * presentation registry that lives in the tree this migration only deletes
 * from, so they are carried across unchanged rather than renamed in flight.
 */
import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  PAID_RETENTION_PRESET_DAYS,
} from "@langwatch/data-retention-contract";
import { TRPCError } from "@trpc/server";
import type { DataRetentionAdministratorPort } from "../ports/data-retention-administrator.port";
import type {
  DataRetentionDirectoryPort,
  RetentionScopeTarget,
} from "../ports/data-retention-directory.port";
import type { DataRetentionPermissionsPort } from "../ports/data-retention-permissions.port";
import type { DataRetentionPlan, DataRetentionPlanPort } from "../ports/data-retention-plan.port";

/** The caller a gate is decided for. */
export type RetentionActor = Readonly<{ userId: string | null; email: string | null }>;

export type DataRetentionPolicyServiceOptions = Readonly<{
  directory: DataRetentionDirectoryPort;
  permissions: DataRetentionPermissionsPort;
  plans: DataRetentionPlanPort;
  administrators: DataRetentionAdministratorPort;
}>;

/**
 * Permission required to write a retention override at a given tier.
 *
 * This MUST mirror the read side, which advertises a scope as writable using
 * exactly these permissions:
 *   - ORGANIZATION → organization:manage
 *   - TEAM         → team:manage
 *   - PROJECT      → project:update
 *
 * PROJECT deliberately uses `project:update`, not `project:manage`: a team
 * MEMBER holds `project:update` but not `project:manage`, and the snapshot
 * already shows them their project as writable. Requiring `project:manage`
 * here made the chip picker offer a scope that the save then rejected with
 * FORBIDDEN. It also keeps these mutations consistent with the retroactive
 * endpoints, which gate on `project:update`.
 */
export function requiredRetentionWritePermission(
  scopeType: RetentionScopeTarget["scopeType"],
): "organization:manage" | "team:manage" | "project:update" {
  if (scopeType === "ORGANIZATION") return "organization:manage";
  if (scopeType === "TEAM") return "team:manage";
  return "project:update";
}

/**
 * Which retention values a plan tier may persist.
 *
 * Tiering is by exclusion: an uncapped plan (enterprise, or self-hosted) may
 * take any whole-week value at or above `customMin`, plus the paid short
 * presets as the sole sub-floor exceptions; every other non-free plan may take
 * ONLY the listed presets. An unrecognised tier resolves to `uncapped: false`
 * upstream and therefore fails CLOSED to the restrictive menu — the
 * data-loss-safe default, not fail-open.
 */
type RetentionRule =
  | { kind: "fixed"; presetDays: readonly number[] }
  | { kind: "uncapped"; customMin: number };

function ruleForPlan(plan: DataRetentionPlan): RetentionRule {
  if (plan.uncapped) {
    return { kind: "uncapped", customMin: ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS };
  }
  return { kind: "fixed", presetDays: PAID_RETENTION_PRESET_DAYS };
}

/**
 * Throws FORBIDDEN if the plan is free. Pure — the single source of the
 * free-tier gate, over an already-resolved plan, so a caller that has the plan
 * in hand doesn't refetch it.
 */
export function assertPlanConfigurable(plan: DataRetentionPlan): void {
  if (!plan.free) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Configuring data retention is a paid-plan feature. " +
      "All projects use the platform default until the organization upgrades.",
  });
}

/**
 * Throws FORBIDDEN if `plan` may not persist `retentionDays`. Pure — operates
 * on an already-resolved plan and reads only the tier rule, so it is trivially
 * unit-testable and does no I/O. This is the write-path prevention that stops a
 * paid organization persisting an arbitrary window through the tRPC surface,
 * independent of what the UI offers.
 *
 * No-ops on the indefinite sentinel (keep-forever is authorized separately, by
 * the platform-administrator gate) and on free plans (blocked by the free gate).
 */
export function assertPlanAllowsRetentionValue(
  plan: DataRetentionPlan,
  retentionDays: number,
): void {
  if (retentionDays === INDEFINITE_RETENTION_DAYS) return;
  if (plan.free) return;

  const rule = ruleForPlan(plan);

  if (rule.kind === "uncapped") {
    // The paid short presets are the only values allowed below the enterprise
    // custom floor. Everything else must clear the floor; whole-week alignment
    // is already enforced by the contract's own day schema.
    if ((PAID_RETENTION_PRESET_DAYS as readonly number[]).includes(retentionDays)) {
      return;
    }
    if (retentionDays < rule.customMin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Retention must be at least ${rule.customMin} days on your plan.`,
      });
    }
    return;
  }

  if (!rule.presetDays.includes(retentionDays)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "That retention length isn't available on your plan. " +
        "Choose one of the offered options, or contact us to unlock more.",
    });
  }
}

export class DataRetentionPolicyService {
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
    if (!input.organizationId) return false;
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
    scope: RetentionScopeTarget;
  }): Promise<void> {
    if (await this.canWriteScope(input)) return;
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You need ${requiredRetentionWritePermission(
        input.scope.scopeType,
      )} on this ${input.scope.scopeType.toLowerCase()} to change its data retention.`,
    });
  }

  /**
   * Disabling retention (keep data indefinitely, exempt from TTL deletion) is a
   * platform-level capability, NOT a customer tier. The UI hides the option
   * from everyone else; this is the matching server-side enforcement.
   */
  assertCanDisableRetention(input: { actor: RetentionActor }): void {
    if (
      this.options.administrators.isPlatformAdministrator({
        userId: input.actor.userId,
        email: input.actor.email,
      })
    ) {
      return;
    }
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only platform administrators can disable data retention " + "(keep data indefinitely).",
    });
  }

  /**
   * Plan-gate a scope-targeted mutation against the organization that owns the
   * SCOPE — never against the caller-supplied project id. Without this, a
   * caller who manages a scope in a free organization and also has a paid
   * project elsewhere could pass that paid project id alongside the free-org
   * scope and bypass the paid-tier gate.
   */
  async assertPlanForScope(input: {
    actor: RetentionActor;
    scope: RetentionScopeTarget;
  }): Promise<void> {
    const { plan } = await this.resolveScopePlan(input);
    assertPlanConfigurable(plan);
  }

  /** Plan-gate a project-targeted mutation via the project's owning organization. */
  async assertPlanForProject(input: { actor: RetentionActor; projectId: string }): Promise<void> {
    const lineage = await this.options.directory.tryGetProjectLineage({
      projectId: input.projectId,
    });
    const organizationId = lineage?.organizationId;
    if (!organizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project does not belong to any organization.",
      });
    }
    const plan = await this.options.plans.getPlan({
      organizationId,
      userId: input.actor.userId,
    });
    assertPlanConfigurable(plan);
  }

  /**
   * The full write gate for a NEW value: resolve the scope's owning-organization
   * plan ONCE, then apply the free gate and the value gate to it. Retroactive
   * apply replays an already-stored value and is deliberately NOT value-gated;
   * it still runs the free gate through {@link assertPlanForScope}.
   */
  async assertWriteAllowed(input: {
    actor: RetentionActor;
    scope: RetentionScopeTarget;
    retentionDays: number;
  }): Promise<void> {
    const { plan } = await this.resolveScopePlan(input);
    assertPlanConfigurable(plan);
    assertPlanAllowsRetentionValue(plan, input.retentionDays);
  }

  private async canWriteScope(input: {
    actor: RetentionActor;
    scope: RetentionScopeTarget;
  }): Promise<boolean> {
    const userId = input.actor.userId;
    if (!userId) return false;
    const { scopeType, scopeId } = input.scope;
    if (scopeType === "ORGANIZATION") {
      return await this.options.permissions.canManageOrganization({
        userId,
        organizationId: scopeId,
      });
    }
    const organizationId = await this.options.directory.tryResolveScopeOrganizationId({
      scope: input.scope,
    });
    if (!organizationId) return false;
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
    scope: RetentionScopeTarget;
  }): Promise<{ organizationId: string; plan: DataRetentionPlan }> {
    const organizationId = await this.options.directory.tryResolveScopeOrganizationId({
      scope: input.scope,
    });
    if (!organizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `${input.scope.scopeType.toLowerCase()} ${input.scope.scopeId} was not found.`,
      });
    }
    const plan = await this.options.plans.getPlan({
      organizationId,
      userId: input.actor.userId,
    });
    return { organizationId, plan };
  }
}
