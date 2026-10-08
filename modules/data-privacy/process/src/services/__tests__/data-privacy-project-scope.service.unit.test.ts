import { describe, expect, it, vi } from "vitest";

import { dataPrivacyTestPlacement } from "../../app/__tests__/data-privacy.fixture.ts";
import type { DataPrivacyProjectScope } from "../../repositories/data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { DataPrivacyResolutionService } from "../data-privacy-resolution.service.ts";

/** Spec: modules/data-privacy/specs/data-privacy-resolution-seam.feature, the placement rule. */

const project = { projectId: "project-1", organizationId: "organization-1" } as const;

function setup(rows: readonly DataPrivacyProjectScope[] = []) {
  const scopes = DataPrivacyProjectScopeService.create({
    repository: MemoryDataPrivacyProjectScopeRepository.create({ projects: rows }),
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
  /** @scenario "An existing project resolves its privacy policy on the first request after deploy" */
  it("resolves a project project recorded no fact for through its row's organization and team", async () => {
    const { scopes, chainOf } = setup([dataPrivacyTestPlacement({ teamId: "alpha" })]);

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
  it("resolves a moved project through the team its row names", async () => {
    const { chainOf } = setup([dataPrivacyTestPlacement({ teamId: "beta" })]);

    const chain = await chainOf(project.projectId);
    expect(chain?.scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ scopeType: "TEAM", scopeId: "beta" })]),
    );
  });

  /** @scenario "A department assigned to a project reaches its resolved policy" */
  it("resolves through the department its row names", async () => {
    const { scopes, chainOf } = setup([dataPrivacyTestPlacement({ departmentId: "risk" })]);

    await expect(scopes.getScopeFacts(project)).resolves.toMatchObject({ departmentId: "risk" });
    const chain = await chainOf(project.projectId);
    expect(chain?.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scopeType: "DEPARTMENT", scopeId: "risk" }),
      ]),
    );
  });

  /** @scenario "A project with no row is refused as not found" */
  it("refuses a project project's table holds no row for", async () => {
    const { scopes } = setup([dataPrivacyTestPlacement()]);

    await expect(scopes.getScopeFacts({ projectId: "project-new" })).rejects.toMatchObject({
      code: "project_not_found",
    });
  });

  /** @scenario "An archived project no longer resolves" */
  it("refuses a project whose row is archived", async () => {
    const { scopes } = setup([dataPrivacyTestPlacement({ archived: true })]);

    await expect(scopes.getScopeFacts(project)).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});
