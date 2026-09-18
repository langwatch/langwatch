/**
 * Who may write a privacy rule where, and which organization a scope target belongs to. Moved
 * out of `platform/app`'s `server/data-privacy/dataPrivacyPolicy.authz.ts` unchanged in
 * behaviour.
 */
import {
  ScopeOutsideOrganizationError,
  ScopeTargetNotFoundError,
  ScopeWriteForbiddenError,
  type DataPrivacyScope,
  type DataPrivacyScopeType,
} from "@langwatch/data-privacy-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import type { DataPrivacyDirectoryReader } from "../app/data-privacy.app.ts";
import type { DataPrivacyPermissionsService } from "./data-privacy-permissions.service.ts";

export class DataPrivacyScopeAuthorizationService {
  /** The permission a rule write at one tier demands. */
  static requiredWritePermission(
    scopeType: DataPrivacyScopeType,
  ): "organization:manage" | "team:manage" | "project:update" {
    // Departments are an organization-level lens, managed by whoever manages
    // the organization. A team MEMBER holds `project:update` but not
    // `project:manage`, and the snapshot already shows them their own project
    // as writable, so PROJECT gates on the narrower of the two.
    if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
      return "organization:manage";
    }

    if (scopeType === "TEAM") {
      return "team:manage";
    }

    return "project:update";
  }

  static create(options: {
    directory: DataPrivacyDirectoryReader;
    permissions: DataPrivacyPermissionsService;
  }): DataPrivacyScopeAuthorizationService {
    return new DataPrivacyScopeAuthorizationService(options.directory, options.permissions);
  }

  private constructor(
    private readonly directory: DataPrivacyDirectoryReader,
    private readonly permissions: DataPrivacyPermissionsService,
  ) {}

  async assertCanWriteScope(input: { userId: string; scope: DataPrivacyScope }): Promise<void> {
    if (await this.canWriteScope(input)) {
      return;
    }

    throw new ScopeWriteForbiddenError(
      input.scope.scopeType,
      DataPrivacyScopeAuthorizationService.requiredWritePermission(input.scope.scopeType),
    );
  }

  async assertScopeBelongsToProjectOrganization(input: {
    projectId: string;
    scope: DataPrivacyScope;
  }): Promise<void> {
    const [scopeOrganizationId, project] = await Promise.all([
      this.directory.findScopeOrganizationId({ scope: input.scope }),
      this.directory.findProjectLineage({ projectId: input.projectId }),
    ]);
    if (!scopeOrganizationId) {
      throw new ScopeTargetNotFoundError();
    }

    const projectOrganizationId = project?.organizationId ?? null;
    if (!projectOrganizationId) {
      throw new ProjectNotFoundError();
    }

    if (projectOrganizationId !== scopeOrganizationId) {
      throw new ScopeOutsideOrganizationError();
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
          : await this.directory.findScopeOrganizationId({ scope });
      if (!organizationId) {
        return false;
      }

      return this.permissions.canManageOrganization({ userId, organizationId });
    }

    if (scope.scopeType === "TEAM") {
      const organizationId = await this.directory.findScopeOrganizationId({ scope });
      if (!organizationId) {
        return false;
      }

      const decisions = await this.permissions.canManageTeams({
        userId,
        organizationId,
        teamIds: [scope.scopeId],
      });

      return decisions.get(scope.scopeId) === true;
    }

    const decisions = await this.permissions.canUpdateProjects({
      userId,
      organizationId: await this.directory.findScopeOrganizationId({ scope }),
      projectIds: [scope.scopeId],
    });

    return decisions.get(scope.scopeId) === true;
  }
}
