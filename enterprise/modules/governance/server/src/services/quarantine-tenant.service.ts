// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The quarantine fill evaluator's tenant resolution is really a project
 * lookup: every organization's quarantine bucket lives in its internal
 * governance project, which is `ProjectApi`'s concept, not this module's.
 */
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import type { QuarantineTenantResolver } from "../app/governance.members.ts";

/** The one project operation this service needs, out of `ProjectApi`'s whole surface. */
type QuarantineTenantProjects = Pick<ProjectApi, "ensureInternal">;

export class ProjectQuarantineTenantResolverService implements QuarantineTenantResolver {
  private constructor(private readonly projects: QuarantineTenantProjects) {}

  static create(projects: QuarantineTenantProjects): ProjectQuarantineTenantResolverService {
    return new ProjectQuarantineTenantResolverService(projects);
  }

  async resolveTenantId(organizationId: string): Promise<string> {
    const internal = await this.projects.ensureInternal({
      organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    return internal.id;
  }
}
