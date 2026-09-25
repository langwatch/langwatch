// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The three gates every `/api/auth/cli` governance route applies before it
 * reads anything: the device bearer, the plan, and the RBAC permission — plus
 * the current-membership boundary the credential routes add on top.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  type PlanProvider,
} from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { UserApi } from "@langwatch/user-contract";

const logger = createLogger("langwatch:governance-cli");

/** The identity a validated CLI access token carries. */
export type GovernanceCliCaller = Readonly<{
  user_id: string;
  organization_id: string;
  /** The session's login key, parent of every personal key it mints. */
  cli_api_key_id?: string | undefined;
  client_info?:
    | Readonly<{ device_label?: string | undefined; hostname?: string | undefined }>
    | undefined;
}>;

/**
 * The device session behind a request, as this process reads it.
 *
 * Declared structurally rather than imported from the package that WRITES the
 * token records: the two halves of `/api/auth/cli` are owned by two features
 * on purpose, and the reader is the only thing this half needs.
 */
export type GovernanceCliAccessToken = Readonly<{
  /** The caller behind an `Authorization` header, or nothing. */
  resolve: (authHeader: string | null | undefined) => Promise<GovernanceCliCaller | null>;
  /**
   * Severs the presented token, so an offboarded caller's pre-removal session
   * stops authenticating the moment it is refused rather than at its next
   * hourly expiry.
   */
  revoke: (input: { authHeader: string | null | undefined; userId: string }) => Promise<void>;
}>;

/** Which Enterprise surface a route sits behind, for the plan gate's copy. */
export type GovernanceCliEnterpriseFeature = "ingestionSources" | "activityMonitor";

/** The plan gate's verdict, with the upgrade page a refusal points at. */
export type GovernanceCliPlanDecision =
  | Readonly<{ entitled: true }>
  | Readonly<{ entitled: false; errorMessage: string; upgradeUrl: string }>;

/** Whether the caller still holds an active seat in the token's organization. */
export type GovernanceCliMembershipDecision = Readonly<{ active: boolean }>;

/** The complete admission result for one CLI governance request. */
export type GovernanceCliAdmission =
  | Readonly<{ outcome: "admitted"; caller: GovernanceCliCaller }>
  | Readonly<{ outcome: "unauthorized" }>
  | Readonly<{ outcome: "payment-required"; errorMessage: string; upgradeUrl: string }>
  | Readonly<{ outcome: "forbidden"; permission: AuthzPermission }>
  | Readonly<{ outcome: "membership-ended" }>;

const ENTERPRISE_MESSAGE: Record<GovernanceCliEnterpriseFeature, string> = {
  ingestionSources: ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
  activityMonitor: ENTERPRISE_FEATURE_ERRORS.ACTIVITY_MONITOR,
};

/** Everything the gates reach that they do not own. */
export type GovernanceCliAccessMembers = Readonly<{
  accessTokens: GovernanceCliAccessToken;
  users: Pick<UserApi, "findById">;
  /** Active seats only: a disabled seat is not a membership. */
  organizations: Pick<OrganizationApi, "isMember">;
  plans: () => PlanProvider;
  permittedOnOrganization: (input: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }) => Promise<boolean>;
  /** The deployment's public origin; the upgrade link is built from it. */
  publicBaseUrl?: string | undefined;
}>;

/** What the CLI governance transport asks before it serves a route. */
export interface GovernanceCliAccessApi {
  admit(input: {
    authorization: string | null;
    feature?: GovernanceCliEnterpriseFeature;
    permission?: AuthzPermission;
    requireActiveMembership?: boolean;
  }): Promise<GovernanceCliAdmission>;
  findCaller: (authHeader: string | null) => Promise<GovernanceCliCaller | null>;
  planDecision(input: {
    organizationId: string;
    feature: GovernanceCliEnterpriseFeature;
  }): Promise<GovernanceCliPlanDecision>;
  organizationPermission(input: {
    caller: GovernanceCliCaller;
    permission: AuthzPermission;
  }): Promise<boolean>;
  activeMembership(input: {
    caller: GovernanceCliCaller;
    authHeader: string | null;
  }): Promise<GovernanceCliMembershipDecision>;
}

export class GovernanceCliAccessService implements GovernanceCliAccessApi {
  private constructor(private readonly members: GovernanceCliAccessMembers) {}

  static create(members: GovernanceCliAccessMembers): GovernanceCliAccessService {
    return new GovernanceCliAccessService(members);
  }

  findCaller(authHeader: string | null): Promise<GovernanceCliCaller | null> {
    return this.members.accessTokens.resolve(authHeader);
  }

  async admit(input: {
    authorization: string | null;
    feature?: GovernanceCliEnterpriseFeature;
    permission?: AuthzPermission;
    requireActiveMembership?: boolean;
  }): Promise<GovernanceCliAdmission> {
    const caller = await this.findCaller(input.authorization);
    if (!caller) return { outcome: "unauthorized" };

    if (input.feature) {
      const plan = await this.planDecision({
        organizationId: caller.organization_id,
        feature: input.feature,
      });
      if (!plan.entitled) {
        return {
          outcome: "payment-required",
          errorMessage: plan.errorMessage,
          upgradeUrl: plan.upgradeUrl,
        };
      }
    }

    if (
      input.permission &&
      !(await this.organizationPermission({ caller, permission: input.permission }))
    ) {
      return { outcome: "forbidden", permission: input.permission };
    }

    if (input.requireActiveMembership) {
      const membership = await this.activeMembership({ caller, authHeader: input.authorization });
      if (!membership.active) return { outcome: "membership-ended" };
    }

    return { outcome: "admitted", caller };
  }

  /**
   * The Enterprise gate. Fail-closed: a lookup that throws refuses, because
   * "we could not tell" is not "you are entitled".
   */
  async planDecision(input: {
    organizationId: string;
    feature: GovernanceCliEnterpriseFeature;
  }): Promise<GovernanceCliPlanDecision> {
    const errorMessage = ENTERPRISE_MESSAGE[input.feature];

    try {
      await assertEnterprisePlan({
        planProvider: this.members.plans(),
        organizationId: input.organizationId,
        errorMessage,
      });

      return { entitled: true };
    } catch {
      return {
        entitled: false,
        errorMessage,
        upgradeUrl: `${this.consoleBaseUrl()}/settings/subscription`,
      };
    }
  }

  /**
   * The governance RBAC check the browser surfaces make, for the same caller.
   * The bearer only proves organization membership, so without this any member
   * could read every source, every event and the whole setup state.
   */
  organizationPermission(input: {
    caller: GovernanceCliCaller;
    permission: AuthzPermission;
  }): Promise<boolean> {
    return this.members.permittedOnOrganization({
      userId: input.caller.user_id,
      organizationId: input.caller.organization_id,
      permission: input.permission,
    });
  }

  /**
   * The tenancy boundary for key-minting routes: a token proves it has not
   * expired, never that the person is STILL a member. Re-derived from rows,
   * and on refusal the presented session is severed org-scoped, so only this
   * session dies and never the same person's sessions elsewhere.
   */
  async activeMembership(input: {
    caller: GovernanceCliCaller;
    authHeader: string | null;
  }): Promise<GovernanceCliMembershipDecision> {
    const { caller } = input;
    const status = await this.membershipStatus({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });

    if (status === "active") return { active: true };

    try {
      await this.members.accessTokens.revoke({
        authHeader: input.authHeader,
        userId: caller.user_id,
      });
    } catch (err) {
      logger.warn(
        { err, userId: caller.user_id },
        "[governance-cli] failed to revoke stale access token on membership refusal",
      );
    }

    logger.info(
      { userId: caller.user_id, organizationId: caller.organization_id, reason: status },
      "[governance-cli] refusing key-minting request from non-active org member; session revoked",
    );

    return { active: false };
  }

  /** Main's `ensureActiveOrgMemberOr403` read: the user row, then the active seat. */
  private async membershipStatus(input: {
    userId: string;
    organizationId: string;
  }): Promise<"active" | "user_missing" | "user_deactivated" | "not_org_member"> {
    const [user, member] = await Promise.all([
      this.members.users.findById({ id: input.userId }),
      this.members.organizations.isMember(input),
    ]);

    if (!user) return "user_missing";
    if (user.deactivatedAt !== null) return "user_deactivated";
    return member ? "active" : "not_org_member";
  }

  private consoleBaseUrl(): string {
    return (this.members.publicBaseUrl ?? "http://localhost:5560").replace(/\/+$/, "");
  }
}
