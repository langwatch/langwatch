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
  ): "organization:manage" | "team:manage" | "project:manage" {
    // Departments are an organization-level lens, managed by whoever manages the organization.
    // PROJECT is `project:manage`: a Member holds `project:update`, and a project rule beats
    // the tiers above it, so `project:update` would let a Member lift an Admins-only rule.
    if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
      return "organization:manage";
    }

    if (scopeType === "TEAM") {
      return "team:manage";
    }

    return "project:manage";
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

  /** Answers the organization both belong to, which a rule write lands in. */
  async assertScopeBelongsToProjectOrganization(input: {
    projectId: string;
    scope: DataPrivacyScope;
  }): Promise<string> {
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

    return projectOrganizationId;
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

    const decisions = await this.permissions.canManageProjects({
      userId,
      organizationId: await this.directory.findScopeOrganizationId({ scope }),
      projectIds: [scope.scopeId],
    });

    return decisions.get(scope.scopeId) === true;
  }
}
