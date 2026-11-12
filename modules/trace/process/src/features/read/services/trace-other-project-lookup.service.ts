import type { ApiKeyApi } from "@langwatch/api-key-contract";
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
  apiKeys: Pick<ApiKeyApi, "findById">;
  authz: Pick<AuthzApi, "canBatchByIds">;
  existence: Pick<TraceExistenceRepository, "findProjectsHoldingTrace">;
};

type TraceOtherProjectLookup = {
  located?: { project: ProjectIdentity; keyMayRead: boolean };
  /** The other projects the id was looked for in, so a not-found can say what was searched. */
  searchedProjectSlugs: string[];
};

/**
 * Where a trace id that missed in the caller's project lives: only the organisation's other
 * projects the key, or the person behind it, may read are searched, so a project the caller
 * cannot read is never named.
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
    const ownerUserId = await this.ownerOf({ principal, organizationId });
    const others = (
      await this.deps.projects.findLiveNonGovernanceIdsByOrganization({ organizationId })
    )
      .filter((id) => id !== projectId)
      .slice(0, MAX_PROJECTS_SEARCHED);
    if (others.length === 0) return { searchedProjectSlugs: [] };

    const identities = await this.deps.projects.listNamesByIds({ projectIds: others });
    const keyReads = await this.readable({ principal, organizationId, identities });
    const ownerReads =
      ownerUserId && principal.type === "apiKey"
        ? await this.readable({
            principal: { type: "user", id: ownerUserId },
            organizationId,
            identities,
          })
        : keyReads;
    const searchable = identities.filter((p) => keyReads.has(p.id) || ownerReads.has(p.id));
    if (searchable.length === 0) return { searchedProjectSlugs: [] };

    const holding = new Set(
      await this.deps.existence.findProjectsHoldingTrace({
        projectIds: searchable.map((p) => p.id),
        traceId,
      }),
    );
    const found = searchable.filter((p) => holding.has(p.id));
    const project = found.find((p) => keyReads.has(p.id)) ?? found[0];
    return {
      ...(project ? { located: { project, keyMayRead: keyReads.has(project.id) } } : {}),
      searchedProjectSlugs: searchable.map((p) => p.slug),
    };
  }

  /** The person a key acts for (or was made by); null for a key of another organisation. */
  private async ownerOf({
    principal,
    organizationId,
  }: {
    principal: PrincipalRef;
    organizationId: string;
  }): Promise<string | null> {
    if (principal.type === "user") return principal.id;
    const key = await this.deps.apiKeys.findById({ id: principal.id });
    if (!key || key.organizationId !== organizationId) return null;
    return key.userId ?? key.createdByUserId;
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
