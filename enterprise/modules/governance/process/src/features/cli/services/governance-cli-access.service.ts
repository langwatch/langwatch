// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The current-membership boundary the `/api/auth/cli` credential routes add once the CLI token
 * door has admitted the bearer. The plan and the permission are declared on the routes (Q31).
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type { GovernanceCliRequest } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { UserApi } from "@langwatch/user-contract";

const logger = createLogger("langwatch:governance-cli");

/** The identity a validated CLI access token carries. */
export type GovernanceCliCaller = Readonly<{
  user_id: string;
  organization_id: string;
  /** The store key that severs the presented bearer. */
  token_key: string;
  /** The session's login key, parent of every personal key it mints. */
  cli_api_key_id?: string | undefined;
  client_info?:
    | Readonly<{ device_label?: string | undefined; hostname?: string | undefined }>
    | undefined;
}>;

/** Whether the caller still holds an active seat in the token's organization. */
type GovernanceCliMembershipDecision = Readonly<{ active: boolean }>;

/** The complete admission result for one CLI governance request. */
export type GovernanceCliAdmission =
  | Readonly<{ outcome: "admitted"; caller: GovernanceCliCaller }>
  | Readonly<{ outcome: "membership-ended" }>;

/** Everything the gates reach that they do not own. */
export type GovernanceCliAccessMembers = Readonly<{
  /** Auth owns CLI sessions; a refused seat severs the presented one there. */
  sessions: Pick<AuthApi, "revokeCliTokens">;
  users: Pick<UserApi, "findById">;
  /** Active seats only: a disabled seat is not a membership. */
  organizations: Pick<OrganizationApi, "isMember">;
}>;

/** What the CLI governance transport asks before it serves a route. */
export interface GovernanceCliAccessApi {
  admit(
    input: GovernanceCliRequest & { requireActiveMembership?: boolean },
  ): Promise<GovernanceCliAdmission>;
  activeMembership(input: {
    caller: GovernanceCliCaller;
  }): Promise<GovernanceCliMembershipDecision>;
}

export class GovernanceCliAccessService implements GovernanceCliAccessApi {
  private constructor(private readonly members: GovernanceCliAccessMembers) {}

  static create(members: GovernanceCliAccessMembers): GovernanceCliAccessService {
    return new GovernanceCliAccessService(members);
  }

  async admit(
    input: GovernanceCliRequest & { requireActiveMembership?: boolean },
  ): Promise<GovernanceCliAdmission> {
    const caller = callerOf(input);

    if (input.requireActiveMembership) {
      const membership = await this.activeMembership({ caller });
      if (!membership.active) return { outcome: "membership-ended" };
    }

    return { outcome: "admitted", caller };
  }

  /**
   * The tenancy boundary for key-minting routes: a token proves it has not
   * expired, never that the person is STILL a member. Re-derived from rows,
   * and on refusal the presented session is severed org-scoped, so only this
   * session dies and never the same person's sessions elsewhere.
   */
  async activeMembership(input: {
    caller: GovernanceCliCaller;
  }): Promise<GovernanceCliMembershipDecision> {
    const { caller } = input;
    const status = await this.membershipStatus({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });

    if (status === "active") return { active: true };

    try {
      await this.members.sessions.revokeCliTokens({
        userId: caller.user_id,
        tokenKeys: [caller.token_key],
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
}

/** The caller the CLI token door put on the request, in this plane's wire vocabulary. */
function callerOf({ actor, session, organizationId }: GovernanceCliRequest): GovernanceCliCaller {
  const { tokenKey, cliApiKeyId, clientInfo } = session;

  return {
    user_id: actor.id,
    organization_id: organizationId,
    token_key: tokenKey,
    ...(cliApiKeyId ? { cli_api_key_id: cliApiKeyId } : {}),
    ...(clientInfo
      ? { client_info: { device_label: clientInfo.deviceLabel, hostname: clientInfo.hostname } }
      : {}),
  };
}
