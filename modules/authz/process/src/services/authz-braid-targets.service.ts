import type { AuthzBraidTargets, AuthzListBraidTargetsInput } from "@langwatch/authz-contract";

import type { ScopeLineageRepository } from "../repositories/authz-read.repository.ts";
import type { AuthzService } from "./authz.service.ts";

/**
 * The braid dialog's picker (ADR-183 §2): nobody braids into a project whose traces they cannot
 * read, so those are left out; the braid's own project and aggregates are listed but refused.
 */
export class AuthzBraidTargetsService {
  static create(deps: {
    lineage: Pick<ScopeLineageRepository, "findProjectLineage">;
    decisions: Pick<AuthzService, "canBatchPermissionsByIds">;
  }): AuthzBraidTargetsService {
    return new AuthzBraidTargetsService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof AuthzBraidTargetsService.create>[0],
  ) {}

  async listBraidTargets({
    projectId,
    projectIds,
    caller,
  }: AuthzListBraidTargetsInput): Promise<AuthzBraidTargets> {
    const owner = await this.deps.lineage.findProjectLineage({ projectId });
    if (!owner) return [];
    const asked = [...new Set(projectIds)];
    const lineages = await Promise.all(
      asked.map(async (id) => ({
        projectId: id,
        lineage: await this.deps.lineage.findProjectLineage({ projectId: id }),
      })),
    );
    const candidates = lineages.flatMap(({ projectId: id, lineage }) =>
      lineage &&
      lineage.organizationId === owner.organizationId &&
      lineage.kind !== "internal_governance"
        ? [{ projectId: id, teamId: lineage.teamId, kind: lineage.kind }]
        : [],
    );
    if (candidates.length === 0) return [];
    const { byPermission } = await this.deps.decisions.canBatchPermissionsByIds({
      principal: caller,
      permissions: ["traces:view"],
      organizationId: owner.organizationId,
      teams: [],
      projects: candidates.map(({ projectId: id, teamId }) => ({ projectId: id, teamId })),
    });
    const readable = byPermission.get("traces:view")?.projects;
    return candidates
      .filter(({ projectId: id }) => readable?.get(id) === true)
      .map(({ projectId: id, kind }): AuthzBraidTargets[number] => {
        if (id === projectId) return { projectId: id, selectable: false, reason: "this_project" };
        if (kind === "aggregate") return { projectId: id, selectable: false, reason: "aggregate" };
        return { projectId: id, selectable: true };
      });
  }
}
