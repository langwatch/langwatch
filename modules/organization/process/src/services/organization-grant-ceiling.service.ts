import {
  CustomRoleNotAssignableError,
  GrantExceedsCallerPermissionsError,
  permissionsConferred,
  type AuthzApi,
  type AuthzGrantCaller,
  type GrantScopeTier,
  type TeamUserRole,
} from "@langwatch/authz-contract";

const WIRE_SCOPE = { ORGANIZATION: "organization", TEAM: "team", PROJECT: "project" } as const;

/** One grant a door is about to write, or to store for later (an invitation). */
export type OrganizationIntendedGrant = Readonly<{
  role: TeamUserRole;
  customRoleId?: string | null;
  scopeType: GrantScopeTier;
  scopeId: string;
  /**
   * The tier the role is granted at, where that differs from where it is asked:
   * a team not created yet is asked at its organization.
   */
  confersAs?: GrantScopeTier;
}>;

/**
 * Authz's escalation rule asked BEFORE a door writes anything of its own (a group, an invitation),
 * so a refusal leaves nothing behind. authz runs the same rule again on the grant write itself.
 */
export class OrganizationGrantCeilingService {
  static create(
    authz: Pick<AuthzApi, "findPermissionsBeyondCaller" | "findRolePermissions">,
  ): OrganizationGrantCeilingService {
    return new OrganizationGrantCeilingService(authz);
  }

  private constructor(
    private readonly authz: Pick<AuthzApi, "findPermissionsBeyondCaller" | "findRolePermissions">,
  ) {}

  async assertWithinCaller({
    organizationId,
    caller,
    grants,
  }: {
    organizationId: string;
    caller: AuthzGrantCaller;
    grants: readonly OrganizationIntendedGrant[];
  }): Promise<void> {
    if (caller.type === "system" || grants.length === 0) return;

    const roleIds = [
      ...new Set(grants.flatMap((grant) => (grant.customRoleId ? [grant.customRoleId] : []))),
    ];
    const roles =
      roleIds.length > 0 ? await this.authz.findRolePermissions({ organizationId, roleIds }) : [];
    const permissionsByRoleId = new Map(roles.map((role) => [role.id, role.permissions]));
    // An unknown role is refused, as authz's writer refuses it, never read as conferring nothing.
    const unknownRoleId = roleIds.find((roleId) => !permissionsByRoleId.has(roleId));
    if (unknownRoleId) throw new CustomRoleNotAssignableError(unknownRoleId);

    for (const grant of grants) {
      const conferred = [
        ...permissionsConferred({
          role: grant.role,
          scopeType: grant.confersAs ?? grant.scopeType,
          customPermissions: permissionsByRoleId.get(grant.customRoleId ?? "") ?? [],
        }),
      ];
      // An anonymous caller answers for nothing: every conferred permission is beyond it.
      const missing =
        caller.type === "anonymous"
          ? conferred
          : await this.authz.findPermissionsBeyondCaller({
              organizationId,
              caller,
              scope: { type: WIRE_SCOPE[grant.scopeType], id: grant.scopeId },
              permissions: conferred,
            });
      if (missing.length > 0) throw new GrantExceedsCallerPermissionsError(missing);
    }
  }
}
