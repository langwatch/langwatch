import type { AuthzBraidTargets, AuthzListBraidTargetsInput } from "@langwatch/authz-contract";

import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";
import type { AuthzService } from "./authz.service.ts";

/**
 * The braid dialog's picker (ADR-185 §2): nobody braids into a project whose traces they cannot
 * read, so those are left out; the braid's own project and aggregates are listed but refused.
 */
export class AuthzBraidTargetsService {
  static create(deps: {
    lineage: Pick<AuthzReadRepository, "findProjectLineages">;
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
    const asked = [...new Set(projectIds)];
    // One lineage read for the braid's own project and every asked one.
    const lineages = await this.deps.lineage.findProjectLineages({
      projectIds: [projectId, ...asked],
    });
    const owner = lineages.get(projectId);
    if (!owner) return [];
    const candidates = asked.flatMap((id) => {
      const lineage = lineages.get(id);
      return lineage &&
        lineage.organizationId === owner.organizationId &&
        lineage.kind !== "internal_governance"
        ? [{ projectId: id, teamId: lineage.teamId, kind: lineage.kind }]
        : [];
    });
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
