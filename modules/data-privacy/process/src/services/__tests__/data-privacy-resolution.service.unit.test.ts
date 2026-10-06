import { describe, expect, it, vi } from "vitest";

import {
  createDataPrivacyTestScopes,
  dataPrivacyTestGraph,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { DataPrivacyResolutionService } from "../data-privacy-resolution.service.ts";

/**
 * Spec: modules/data-privacy/specs/data-privacy-resolution-seam.feature.
 * Resolving a project's policy asks no other module: data privacy's own project-scope fold
 * carries the organization, team and department the chain is built from.
 */

const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

async function resolution(options: { drops?: boolean } = {}) {
  const repository = MemoryDataPrivacyPolicyRepository.create();
  if (options.drops) {
    await repository.upsertForScope({
      organizationId: ORGANIZATION_ID,
      scope: { scopeType: "PROJECT", scopeId: "project-1" },
      personalOnly: false,
      config: { categories: { input: { disposition: "drop" } } },
    });
  }

  const findForProjectChain = vi.spyOn(repository, "findForProjectChain");

  return {
    findForProjectChain,
    built: DataPrivacyResolutionService.create({
      repository,
      scopes: DataPrivacyProjectScopeService.create({
        repository: await createDataPrivacyTestScopes(),
      }),
    }),
  };
}

describe("DataPrivacyResolutionService", () => {
  describe("given a policy store and a folded scope for a project", () => {
    describe("when a project's policy is resolved", () => {
      /** @scenario "The policy resolution composes from a database and its own project-scope fold" */
      it("reads the chain from the project's own organization", async () => {
        const { built, findForProjectChain } = await resolution();

        await expect(
          built.getResolvedForProject({ projectId: "project-1" }),
        ).resolves.toMatchObject({ categories: expect.any(Object) });
        expect(findForProjectChain).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          scopes: expect.arrayContaining([
            expect.objectContaining({ scopeType: "PROJECT", scopeId: "project-1" }),
          ]),
        });
      });

      /** @scenario "A stored drop rule reaches the resolved policy" */
      it("carries a project-scoped rule into the resolution", async () => {
        const { built } = await resolution({ drops: true });

        const resolved = await built.getResolvedForProject({ projectId: "project-1" });

        expect(resolved.categories.input.disposition).toBe("drop");
      });

      /** @scenario "A second resolution inside the window reuses the first" */
      it("reads the policy rows once per project inside the cache window", async () => {
        const { built, findForProjectChain } = await resolution();

        await built.getResolvedForProject({ projectId: "project-1" });
        await built.getResolvedForProject({ projectId: "project-1" });

        expect(findForProjectChain).toHaveBeenCalledTimes(1);
      });
    });
  });
});
