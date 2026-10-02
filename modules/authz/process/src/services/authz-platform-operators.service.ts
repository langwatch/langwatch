/**
 * The PLATFORM decision tier (ADR-092; ARCHITECTURE.md "Platform operators are a grant"):
 * who holds the platform-operator role, and the rules for granting and revoking it.
 */
import {
  builtinRoleGrants,
  GrantExceedsCallerPermissionsError,
  GrantNotFoundError,
  GrantValidationError,
  PLATFORM_GRANT_ERASURE_REASON,
  PLATFORM_OPERATOR_ROLE_ID,
  PlatformOperatorLastHolderError,
  PlatformOperatorSelfGrantError,
  type AuthzGrantCaller,
  type AuthzGrantPlatformOperatorInput,
  type AuthzPrincipalRef,
  type AuthzRevokePlatformOperatorInput,
  type PlatformOperator,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";

import type { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import type { AuthzPlatformGrantRepository } from "../repositories/authz-platform-grant.repository.ts";
import type { AuthzUserStandingRepository } from "../repositories/authz-user-standing.repository.ts";

const MANAGE_PERMISSION = "ops:manage";

/** The ledger's platform-tier writes. */
export type PlatformGrantLedger = Pick<
  EventingAuthzLedgerAdapter,
  "attachPlatformGrant" | "revokePlatformGrants"
>;

type AuthzPlatformOperatorsOptions = {
  grants: AuthzPlatformGrantRepository;
  standings: AuthzUserStandingRepository;
  ledger: PlatformGrantLedger;
  newGrantId: () => string;
};

export class AuthzPlatformOperatorsService {
  static create(options: AuthzPlatformOperatorsOptions): AuthzPlatformOperatorsService {
    return new AuthzPlatformOperatorsService(options);
  }

  private constructor(private readonly options: AuthzPlatformOperatorsOptions) {}

  /** Only a user's live PLATFORM grant answers, and only for the role's own permissions. */
  async can({
    principal,
    permission,
  }: {
    principal: AuthzPrincipalRef;
    permission: string;
  }): Promise<boolean> {
    if (principal.type !== "user") return false;
    if (!builtinRoleGrants({ role: PLATFORM_OPERATOR_ROLE_ID, permission })) return false;
    const held = await this.findActiveGrants({ userId: principal.id });

    return held.length > 0;
  }

  /** Every live holder, oldest first. */
  list(): Promise<PlatformOperator[]> {
    return this.findActiveGrants({});
  }

  /** Grants the role to a user; a user who already holds it keeps the grant they have. */
  async grant({
    principal,
    caller,
    actor,
    source = "grants-service",
    grantId,
  }: AuthzGrantPlatformOperatorInput): Promise<PlatformOperator> {
    if (principal.type !== "user" || principal.id === null) {
      throw new GrantValidationError("Only a user can hold the platform-operator role", {
        principalType: principal.type,
      });
    }
    const userId = principal.id;
    if (caller.type === "user" && caller.id === userId) {
      throw new PlatformOperatorSelfGrantError({ userId });
    }
    await this.assertMayManage(caller);

    // A deactivated holder keeps their grant too: a second one would duplicate it on reactivation.
    const [existing] = await this.options.grants.findGrants({ userId });
    if (existing) return existing;

    const id = grantId ?? this.options.newGrantId();
    await this.options.ledger.attachPlatformGrant({ grantId: id, userId, actor, source });

    return { grantId: id, userId, grantedAt: nowInstant() };
  }

  /** Revokes one grant; never the last one, unless user erasure (as `system`) asks. */
  async revoke({
    grantId,
    caller,
    actor,
    reason,
  }: AuthzRevokePlatformOperatorInput): Promise<void> {
    await this.assertMayManage(caller);
    const [target] = await this.options.grants.findGrants({ grantId });
    if (!target) throw new GrantNotFoundError(grantId);

    // Only active holders count: a deactivated holder could not operate anyway.
    const live = await this.findActiveGrants({});
    const othersRemain = live.some((row) => row.grantId !== grantId);
    if (!othersRemain && !(await this.isErasureOf({ target, caller, reason }))) {
      throw new PlatformOperatorLastHolderError({ grantId, userId: target.userId });
    }

    await this.options.ledger.revokePlatformGrants({
      grantIds: [grantId],
      actor,
      ...(reason ? { reason } : {}),
    });
  }

  /** The erasure exception: asked as `system`, and the holder is already gone from the tier. */
  private async isErasureOf({
    target,
    caller,
    reason,
  }: {
    target: PlatformOperator;
    caller: AuthzGrantCaller;
    reason: string | undefined;
  }): Promise<boolean> {
    if (caller.type !== "system" || reason !== PLATFORM_GRANT_ERASURE_REASON) return false;
    const inactive = await this.options.standings.findInactiveUserIds({ userIds: [target.userId] });

    return inactive.length > 0;
  }

  /** Revokes an erased user's grants through the erasure path; a redelivery finds none left. */
  async revokeErased({ userId }: { userId: string }): Promise<void> {
    for (const held of await this.options.grants.findGrants({ userId })) {
      await this.revoke({
        grantId: held.grantId,
        caller: { type: "system" },
        actor: { type: "system", id: null },
        reason: PLATFORM_GRANT_ERASURE_REASON,
      });
    }
  }

  /** A deactivated or erased holder's grant confers nothing and counts toward nothing. */
  private async findActiveGrants(narrowing: { userId?: string }): Promise<PlatformOperator[]> {
    const held = await this.options.grants.findGrants(narrowing);
    if (held.length === 0) return [];
    const inactive = new Set(
      await this.options.standings.findInactiveUserIds({ userIds: held.map((row) => row.userId) }),
    );

    return held.filter((row) => !inactive.has(row.userId));
  }

  private async assertMayManage(caller: AuthzGrantCaller): Promise<void> {
    if (caller.type === "system") return;
    if (await this.can({ principal: caller, permission: MANAGE_PERMISSION })) return;
    throw new GrantExceedsCallerPermissionsError([MANAGE_PERMISSION]);
  }
}
