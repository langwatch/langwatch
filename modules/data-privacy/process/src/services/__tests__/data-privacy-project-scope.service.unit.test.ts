import { describe, expect, it, vi } from "vitest";

import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { DataPrivacyResolutionService } from "../data-privacy-resolution.service.ts";

/** Spec: modules/data-privacy/specs/data-privacy-resolution-seam.feature, the fold rule. */

const project = { projectId: "project-1", organizationId: "organization-1" } as const;

function setup() {
  const scopes = DataPrivacyProjectScopeService.create({
    repository: MemoryDataPrivacyProjectScopeRepository.create(),
  });

  /** The scopes a fresh resolution reads its chain at, so no cache stands between cases. */
  async function chainOf(projectId: string) {
    const policies = MemoryDataPrivacyPolicyRepository.create();
    const findForProjectChain = vi.spyOn(policies, "findForProjectChain");
    await DataPrivacyResolutionService.create({
      repository: policies,
      scopes,
    }).getResolvedForProject({ projectId });
    return findForProjectChain.mock.calls[0]?.[0];
  }

  return { scopes, chainOf };
}

const ofType = (type: string) =>
  expect.arrayContaining([expect.objectContaining({ scopeType: type })]);

describe("DataPrivacyProjectScopeService", () => {
  /** @scenario "A new project's scope folds from project's created fact" */
  it("resolves a created project through its organization and team, with no department", async () => {
    const { scopes, chainOf } = setup();

    await scopes.projectCreated({ ...project, teamId: "alpha", isPersonal: false, occurredAt: 10 });

    await expect(scopes.getScopeFacts(project)).resolves.toEqual({
      ...project,
      teamId: "alpha",
      departmentId: null,
      isPersonal: false,
    });
    const chain = await chainOf(project.projectId);
    expect(chain?.organizationId).toBe("organization-1");
    expect(chain?.scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ scopeType: "TEAM", scopeId: "alpha" })]),
    );
    expect(chain?.scopes).not.toEqual(ofType("DEPARTMENT"));
  });

  /** @scenario "A moved project resolves through its new team" */
  it("resolves a moved project through the team the move named", async () => {
    const { scopes, chainOf } = setup();
    await scopes.projectCreated({ ...project, teamId: "alpha", isPersonal: false, occurredAt: 10 });

    await scopes.projectMoved({ ...project, toTeamId: "beta", occurredAt: 20 });

    const chain = await chainOf(project.projectId);
    expect(chain?.scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ scopeType: "TEAM", scopeId: "beta" })]),
    );
  });

  /** @scenario "A department assigned to a project reaches its resolved policy" */
  it("resolves through the department the assignment named", async () => {
    const { scopes, chainOf } = setup();
    await scopes.projectCreated({ ...project, teamId: "alpha", isPersonal: false, occurredAt: 10 });

    await scopes.departmentAssigned({
      ...project,
      departmentId: "risk",
      teamId: "alpha",
      isPersonal: false,
      occurredAt: 20,
    });

    const chain = await chainOf(project.projectId);
    expect(chain?.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scopeType: "DEPARTMENT", scopeId: "risk" }),
      ]),
    );
  });

  /** @scenario "A late or repeated project fact does not overwrite a newer one" */
  it("keeps the move's team and the assignment's department when the older fact repeats", async () => {
    const { scopes } = setup();
    const assignment = {
      ...project,
      departmentId: "risk",
      teamId: "alpha",
      isPersonal: false,
      occurredAt: 10,
    };
    await scopes.departmentAssigned(assignment);
    await scopes.projectMoved({ ...project, toTeamId: "beta", occurredAt: 20 });
    await scopes.projectCreated({ ...project, teamId: "alpha", isPersonal: false, occurredAt: 5 });

    await scopes.departmentAssigned(assignment);

    await expect(scopes.getScopeFacts(project)).resolves.toMatchObject({
      teamId: "beta",
      departmentId: "risk",
    });
  });

  /** @scenario "A project whose scope has not folded yet is refused as not found" */
  it("refuses an unfolded project, and one folded only from a created fact naming no team", async () => {
    const { scopes } = setup();
    await scopes.projectCreated({ projectId: "project-old", organizationId: "o", occurredAt: 1 });

    await expect(scopes.getScopeFacts({ projectId: "project-new" })).rejects.toMatchObject({
      code: "project_not_found",
    });
    await expect(scopes.getScopeFacts({ projectId: "project-old" })).rejects.toMatchObject({
      code: "project_not_found",
    });
  });

  /** @scenario "An archived project no longer resolves" */
  it("refuses a project once it is archived, whatever arrives after", async () => {
    const { scopes } = setup();
    await scopes.projectCreated({ ...project, teamId: "alpha", isPersonal: false, occurredAt: 10 });

    await scopes.projectArchived({ ...project, occurredAt: 20 });
    await scopes.projectMoved({ ...project, toTeamId: "beta", occurredAt: 30 });

    await expect(scopes.getScopeFacts(project)).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});
