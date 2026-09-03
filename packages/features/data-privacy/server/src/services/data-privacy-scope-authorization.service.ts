/**
 * Who may write a privacy rule where, and which organization a scope target
 * belongs to.
 *
 * Moved out of `platform/app`'s `server/data-privacy/dataPrivacyPolicy.authz.ts`
 * unchanged in behaviour. Two guards, and they answer different questions:
 *
 *  - {@link assertCanWriteScope} authorizes the TARGET at its own tier, so a
 *    project member cannot push a rule up to the organization;
 *  - {@link assertScopeBelongsToProjectOrganization} anchors that target to the
 *    organization of the project the caller is acting from, so a request
 *    pairing a project with a scope in an unrelated tenant is refused before
 *    either is written.
 *
 * The permission each tier demands MUST mirror what
 * {@link DataPrivacySnapshotService} advertises as writable, or the chip picker
 * offers a scope the save then rejects.
 */
import type { DataPrivacyScope, DataPrivacyScopeType } from "@langwatch/data-privacy-contract";
import { TRPCError } from "@trpc/server";
import type { DataPrivacyDirectoryPort } from "../ports/data-privacy-directory.port";
import type { DataPrivacyPermissionsPort } from "../ports/data-privacy-permissions.port";

/** The permission a rule write at one tier demands. */
export function requiredDataPrivacyWritePermission(
  scopeType: DataPrivacyScopeType,
): "organization:manage" | "team:manage" | "project:update" {
  // Departments are an organization-level lens, managed by whoever manages the
  // organization. A team MEMBER holds `project:update` but not
  // `project:manage`, and the snapshot already shows them their own project as
  // writable, so PROJECT gates on the narrower of the two.
  if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") return "organization:manage";
  if (scopeType === "TEAM") return "team:manage";
  return "project:update";
}

export class DataPrivacyScopeAuthorizationService {
  static create(options: {
    directory: DataPrivacyDirectoryPort;
    permissions: DataPrivacyPermissionsPort;
  }): DataPrivacyScopeAuthorizationService {
    return new DataPrivacyScopeAuthorizationService(options.directory, options.permissions);
  }

  private constructor(
    private readonly directory: DataPrivacyDirectoryPort,
    private readonly permissions: DataPrivacyPermissionsPort,
  ) {}

  async assertCanWriteScope(input: {
    userId: string;
    scope: DataPrivacyScope;
  }): Promise<void> {
    if (await this.canWriteScope(input)) return;
    // The transport codes the platform surface has always answered with, raised
    // here rather than as a handled error: a new `code` needs an entry in the
    // client presentation registry, and that registry still lives in a tree
    // this migration only deletes from.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You need ${requiredDataPrivacyWritePermission(
        input.scope.scopeType,
      )} on this ${input.scope.scopeType.toLowerCase()} to change its data privacy.`,
    });
  }

  async assertScopeBelongsToProjectOrganization(input: {
    projectId: string;
    scope: DataPrivacyScope;
  }): Promise<void> {
    const [scopeOrganizationId, project] = await Promise.all([
      this.directory.tryResolveScopeOrganizationId({ scope: input.scope }),
      this.directory.tryGetProjectLineage({ projectId: input.projectId }),
    ]);
    if (!scopeOrganizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "The data privacy scope target does not exist.",
      });
    }
    const projectOrganizationId = project?.organizationId ?? null;
    if (!projectOrganizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "The project does not exist." });
    }
    if (projectOrganizationId !== scopeOrganizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The data privacy scope must belong to the same organization as the project.",
      });
    }
  }

  private async canWriteScope(input: {
    userId: string;
    scope: DataPrivacyScope;
  }): Promise<boolean> {
    const { userId, scope } = input;
    if (scope.scopeType === "ORGANIZATION" || scope.scopeType === "DEPARTMENT") {
      const organizationId =
        scope.scopeType === "ORGANIZATION"
          ? scope.scopeId
          : await this.directory.tryResolveScopeOrganizationId({ scope });
      if (!organizationId) return false;
      return this.permissions.canManageOrganization({ userId, organizationId });
    }
    if (scope.scopeType === "TEAM") {
      const organizationId = await this.directory.tryResolveScopeOrganizationId({ scope });
      if (!organizationId) return false;
      const decisions = await this.permissions.canManageTeams({
        userId,
        organizationId,
        teamIds: [scope.scopeId],
      });
      return decisions.get(scope.scopeId) === true;
    }
    const decisions = await this.permissions.canUpdateProjects({
      userId,
      organizationId: await this.directory.tryResolveScopeOrganizationId({ scope }),
      projectIds: [scope.scopeId],
    });
    return decisions.get(scope.scopeId) === true;
  }
}
