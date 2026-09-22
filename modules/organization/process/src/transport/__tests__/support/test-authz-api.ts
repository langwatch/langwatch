/**
 * A complete `AuthzApi` boundary for the teams family's suite: the four
 * operations it reaches are backed by an in-memory binding table; everything
 * else refuses by name, so unexpected authorization access fails loudly here.
 */
import {
  DuplicateBindingError,
  type AuthzAccessBinding,
  type AuthzApi,
  type AuthzAttachBindingsInput,
  type AuthzAttachOutcome,
  type AuthzListScopeBindingsInput,
  type AuthzListTeamMemberBindingsInput,
  type AuthzRevokeBindingsInput,
  type AuthzTeamMemberBinding,
} from "@langwatch/authz-contract";

const unsupported = <Method>(name: string): Method =>
  (() =>
    Promise.reject(new Error(`AuthzApi.${name} is not reached by the teams family`))) as Method;

/** The synchronous refusal: a rejected promise would go unobserved here. */
const unreachable = <Method>(name: string): Method =>
  (() => {
    throw new Error(`AuthzApi.${name} is not reached by the teams family`);
  }) as Method;

/** One person as the authorization boundary reports them beside a binding. */
export type TestAuthzPerson = Readonly<{
  id: string;
  name: string | null;
  email: string | null;
}>;

/** One binding to seed: who holds which role at which team. */
export type TestTeamBindingSeed = Readonly<{
  id: string;
  organizationId: string;
  teamId: string;
  userId: string;
  role: AuthzAccessBinding["role"];
}>;

export class TestAuthzApi implements AuthzApi {
  /** Every binding this boundary holds, in attachment order. */
  readonly bindings: AuthzAccessBinding[] = [];

  readonly #people = new Map<string, TestAuthzPerson>();
  #now = new Date("2026-09-01T00:00:00.000Z");

  static create(options: { people?: readonly TestAuthzPerson[] } = {}): TestAuthzApi {
    const authz = new TestAuthzApi();
    for (const person of options.people ?? []) authz.#people.set(person.id, person);

    return authz;
  }

  /** Seeds a binding the way a team membership write would have left one. */
  seedTeamBinding(seed: TestTeamBindingSeed): void {
    this.bindings.push(this.#row(seed));
  }

  /** The user ids holding a binding on one team, in attachment order. */
  teamMemberIds(teamId: string): string[] {
    return this.bindings
      .filter((binding) => binding.scopeType === "TEAM" && binding.scopeId === teamId)
      .flatMap((binding) => (binding.userId === null ? [] : [binding.userId]));
  }

  async listScopeBindings(args: AuthzListScopeBindingsInput): Promise<AuthzAccessBinding[]> {
    return this.bindings.filter(
      (binding) =>
        binding.organizationId === args.organizationId &&
        binding.scopeType === args.scopeType &&
        args.scopeIds.includes(binding.scopeId),
    );
  }

  async listTeamMemberBindings(
    args: AuthzListTeamMemberBindingsInput,
  ): Promise<Map<string, AuthzTeamMemberBinding[]>> {
    const byTeam = new Map<string, AuthzTeamMemberBinding[]>();
    for (const teamId of args.teamIds) {
      const members = this.bindings
        .filter(
          (binding) =>
            binding.organizationId === args.organizationId &&
            binding.scopeType === "TEAM" &&
            binding.scopeId === teamId &&
            binding.userId !== null,
        )
        .map((binding): AuthzTeamMemberBinding => ({
          userId: binding.userId ?? "",
          role: binding.role,
          customRoleId: binding.customRoleId,
          createdAt: binding.createdAt,
          updatedAt: binding.createdAt,
          user: binding.user ?? {
            id: binding.userId ?? "",
            name: null,
            email: null,
            image: null,
          },
          customRole: binding.customRole,
        }));
      if (members.length > 0) byTeam.set(teamId, members);
    }

    return byTeam;
  }

  async attachBindings(args: AuthzAttachBindingsInput): Promise<AuthzAttachOutcome> {
    const attached: string[] = [];
    const duplicates: string[] = [];

    for (const binding of args.bindings) {
      const userId = "userId" in binding.principal ? binding.principal.userId : null;
      const existing = this.bindings.find(
        (row) =>
          row.organizationId === args.organizationId &&
          row.scopeType === binding.scopeType &&
          row.scopeId === binding.scopeId &&
          row.userId === userId &&
          row.role === binding.role &&
          row.customRoleId === binding.customRoleId,
      );

      if (existing) {
        if (args.onDuplicate === "reject") throw new DuplicateBindingError();
        duplicates.push(binding.bindingId);
        continue;
      }

      this.bindings.push(
        this.#row({
          id: binding.bindingId,
          organizationId: args.organizationId,
          teamId: binding.scopeId,
          userId: userId ?? "",
          role: binding.role,
        }),
      );
      attached.push(binding.bindingId);
    }

    return { attached, duplicates };
  }

  async revokeBindings(args: AuthzRevokeBindingsInput): Promise<void> {
    for (const bindingId of args.bindingIds) {
      const index = this.bindings.findIndex(
        (binding) => binding.id === bindingId && binding.organizationId === args.organizationId,
      );
      if (index >= 0) this.bindings.splice(index, 1);
    }
  }

  #row(seed: TestTeamBindingSeed): AuthzAccessBinding {
    const person = this.#people.get(seed.userId) ?? null;
    this.#now = new Date(this.#now.getTime() + 1_000);

    return {
      id: seed.id,
      organizationId: seed.organizationId,
      userId: seed.userId,
      groupId: null,
      apiKeyId: null,
      role: seed.role,
      customRoleId: null,
      scopeType: "TEAM",
      scopeId: seed.teamId,
      createdAt: this.#now,
      user: person ? { id: person.id, name: person.name, email: person.email, image: null } : null,
      group: null,
      apiKey: null,
      customRole: null,
    };
  }

  isDemoProject = unreachable<AuthzApi["isDemoProject"]>("isDemoProject");
  demoProject = unreachable<AuthzApi["demoProject"]>("demoProject");
  effectivePermissionsFor =
    unsupported<AuthzApi["effectivePermissionsFor"]>("effectivePermissionsFor");
  check = unsupported<AuthzApi["check"]>("check");
  checkDetailed = unsupported<AuthzApi["checkDetailed"]>("checkDetailed");
  can = unsupported<AuthzApi["can"]>("can");
  authorize = unsupported<AuthzApi["authorize"]>("authorize");
  effectivePermissions = unsupported<AuthzApi["effectivePermissions"]>("effectivePermissions");
  checkByIds = unsupported<AuthzApi["checkByIds"]>("checkByIds");
  canAnyByIds = unsupported<AuthzApi["canAnyByIds"]>("canAnyByIds");
  canBatchByIds = unsupported<AuthzApi["canBatchByIds"]>("canBatchByIds");
  canBatchPermissionsByIds = unsupported<AuthzApi["canBatchPermissionsByIds"]>(
    "canBatchPermissionsByIds",
  );
  tryResolveScope = unsupported<AuthzApi["tryResolveScope"]>("tryResolveScope");
  checkScopeLineage = unsupported<AuthzApi["checkScopeLineage"]>("checkScopeLineage");
  explainDecision = unsupported<AuthzApi["explainDecision"]>("explainDecision");
  getDecision = unsupported<AuthzApi["getDecision"]>("getDecision");
  getProjectAnyDecision = unsupported<AuthzApi["getProjectAnyDecision"]>("getProjectAnyDecision");
  hasPermission = unsupported<AuthzApi["hasPermission"]>("hasPermission");
  authorizePermission = unsupported<AuthzApi["authorizePermission"]>("authorizePermission");
  authorizeProjectPermission = unsupported<AuthzApi["authorizeProjectPermission"]>(
    "authorizeProjectPermission",
  );
  hasApiKeyPermission = unsupported<AuthzApi["hasApiKeyPermission"]>("hasApiKeyPermission");
  getApiKeyProjectDecision = unsupported<AuthzApi["getApiKeyProjectDecision"]>(
    "getApiKeyProjectDecision",
  );
  listUserBindings = unsupported<AuthzApi["listUserBindings"]>("listUserBindings");
  listOrganizationBindings = unsupported<AuthzApi["listOrganizationBindings"]>(
    "listOrganizationBindings",
  );
  listUserAndGroupBindings = unsupported<AuthzApi["listUserAndGroupBindings"]>(
    "listUserAndGroupBindings",
  );
  listGroupBindings = unsupported<AuthzApi["listGroupBindings"]>("listGroupBindings");
  listBindingsForSynthesis = unsupported<AuthzApi["listBindingsForSynthesis"]>(
    "listBindingsForSynthesis",
  );
  listUserCreatedRoles = unsupported<AuthzApi["listUserCreatedRoles"]>("listUserCreatedRoles");
  wouldFirstBindingDisableLegacyAccess = unsupported<
    AuthzApi["wouldFirstBindingDisableLegacyAccess"]
  >("wouldFirstBindingDisableLegacyAccess");
  listManagedBindingsForUser = unsupported<AuthzApi["listManagedBindingsForUser"]>(
    "listManagedBindingsForUser",
  );
  listManagedBindingsForOrganization = unsupported<AuthzApi["listManagedBindingsForOrganization"]>(
    "listManagedBindingsForOrganization",
  );
  getAccessBreakdown = unsupported<AuthzApi["getAccessBreakdown"]>("getAccessBreakdown");
  isOnEngine = unsupported<AuthzApi["isOnEngine"]>("isOnEngine");
  findEngineCutoverAt = unsupported<AuthzApi["findEngineCutoverAt"]>("findEngineCutoverAt");
  attach = unsupported<AuthzApi["attach"]>("attach");
  update = unsupported<AuthzApi["update"]>("update");
  revoke = unsupported<AuthzApi["revoke"]>("revoke");
  replace = unsupported<AuthzApi["replace"]>("replace");
  offboard = unsupported<AuthzApi["offboard"]>("offboard");
  invalidateOrganization =
    unsupported<AuthzApi["invalidateOrganization"]>("invalidateOrganization");
  attachResourceGrant = unsupported<AuthzApi["attachResourceGrant"]>("attachResourceGrant");
  revokeResourceGrants = unsupported<AuthzApi["revokeResourceGrants"]>("revokeResourceGrants");
  changeBindingRole = unsupported<AuthzApi["changeBindingRole"]>("changeBindingRole");
  revokeBindingsWhere = unsupported<AuthzApi["revokeBindingsWhere"]>("revokeBindingsWhere");
  offboardMember = unsupported<AuthzApi["offboardMember"]>("offboardMember");
  defineRole = unsupported<AuthzApi["defineRole"]>("defineRole");
  deleteRole = unsupported<AuthzApi["deleteRole"]>("deleteRole");
  createBinding = unsupported<AuthzApi["createBinding"]>("createBinding");
  updateBinding = unsupported<AuthzApi["updateBinding"]>("updateBinding");
  deleteBinding = unsupported<AuthzApi["deleteBinding"]>("deleteBinding");
  applyMemberBindings = unsupported<AuthzApi["applyMemberBindings"]>("applyMemberBindings");
  retireDirectoryGrants = unsupported<AuthzApi["retireDirectoryGrants"]>("retireDirectoryGrants");
  readPendingAdmission = unsupported<AuthzApi["readPendingAdmission"]>("readPendingAdmission");
  completeAdmission = unsupported<AuthzApi["completeAdmission"]>("completeAdmission");
  clearPendingAdmission = unsupported<AuthzApi["clearPendingAdmission"]>("clearPendingAdmission");
  hasProjectPermission = unsupported<AuthzApi["hasProjectPermission"]>("hasProjectPermission");
  deriveGrantId = unsupported<AuthzApi["deriveGrantId"]>("deriveGrantId");
}
