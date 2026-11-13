import type { PrincipalRef } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";

import type { TraceExistenceRepository } from "../../../repositories/trace-existence.repository.ts";

/** Projects one miss may look through; an organisation past this searches its first ones. */
const MAX_PROJECTS_SEARCHED = 100;

type LookupDependencies = {
  projects: Pick<
    ProjectApi,
    "getOrganizationId" | "findLiveNonGovernanceIdsByOrganization" | "listNamesByIds"
  >;
  authz: Pick<AuthzApi, "canBatchByIds">;
  existence: Pick<TraceExistenceRepository, "findProjectsHoldingTrace">;
};

type TraceOtherProjectLookup = {
  located?: { project: ProjectIdentity };
  /** The other projects the id was looked for in, so a not-found can say what was searched. */
  searchedProjectSlugs: string[];
};

/**
 * Where a trace id that missed in the caller's project lives: only the organisation's other
 * projects the caller itself may read are searched, so a project it cannot read is never named.
 */
export class TraceOtherProjectLookupService {
  private constructor(private readonly deps: LookupDependencies) {}

  static create(deps: LookupDependencies): TraceOtherProjectLookupService {
    return new TraceOtherProjectLookupService(deps);
  }

  async locate({
    projectId,
    traceId,
    principal,
  }: {
    projectId: string;
    traceId: string;
    principal: PrincipalRef | null;
  }): Promise<TraceOtherProjectLookup> {
    if (!principal) return { searchedProjectSlugs: [] };
    const organizationId = await this.deps.projects.getOrganizationId(projectId);
    const others = (
      await this.deps.projects.findLiveNonGovernanceIdsByOrganization({ organizationId })
    )
      .filter((id) => id !== projectId)
      .slice(0, MAX_PROJECTS_SEARCHED);
    if (others.length === 0) return { searchedProjectSlugs: [] };

    const identities = await this.deps.projects.listNamesByIds({ projectIds: others });
    const readable = await this.readable({ principal, organizationId, identities });
    const searchable = identities.filter((p) => readable.has(p.id));
    if (searchable.length === 0) return { searchedProjectSlugs: [] };

    const holding = new Set(
      await this.deps.existence.findProjectsHoldingTrace({
        projectIds: searchable.map((p) => p.id),
        traceId,
      }),
    );
    const project = searchable.find((p) => holding.has(p.id));
    return {
      ...(project ? { located: { project } } : {}),
      searchedProjectSlugs: searchable.map((p) => p.slug),
    };
  }

  private async readable({
    principal,
    organizationId,
    identities,
  }: {
    principal: PrincipalRef;
    organizationId: string;
    identities: readonly ProjectIdentity[];
  }): Promise<Set<string>> {
    const answer = await this.deps.authz.canBatchByIds({
      principal,
      permission: "traces:view",
      organizationId,
      teams: [],
      projects: identities.map((p) => ({ projectId: p.id, teamId: p.teamId })),
    });
    return new Set([...answer.projects].filter(([, allowed]) => allowed).map(([id]) => id));
  }
}
