import type { CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub";
import { AuthzService } from "../authz.service";

const ORG = "org-1";

const key = { type: "apiKey", id: "key-1" } as const;

const binding = (role: CollectedBinding["role"], projectId: string): CollectedBinding => ({
  role,
  customRoleId: null,
  scopeType: "PROJECT",
  scopeId: projectId,
  viaGroupId: null,
});

const manyProjects = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    projectId: `proj-${index}`,
    teamId: `team-${index}`,
  }));

function makeAuthz(reader: ReturnType<typeof makeReader>) {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: reader,
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzBindingRepository(),
  });
}

describe("AuthzService.canBatchPermissionsByIds", () => {
  describe("given a service key bound admin on one project and viewer on another", () => {
    const reader = () =>
      makeReader({
        findApiKeyBindings: vi
          .fn()
          .mockResolvedValue([binding("ADMIN", "proj-0"), binding("VIEWER", "proj-1")]),
      });

    /** @scenario "A large organization's rollup is decided from one grant snapshot" */
    it("collects the key's grants once for every project and permission", async () => {
      const stub = reader();
      const projects = manyProjects(40);

      await makeAuthz(stub).canBatchPermissionsByIds({
        principal: key,
        permissions: ["traces:view", "cost:view"],
        organizationId: ORG,
        teams: [],
        projects,
      });

      // One collection serves permissions × projects: the whole point of the
      // batch is that 40 projects and 2 permissions cost the same reads as 1.
      expect(stub.findApiKeyBindings).toHaveBeenCalledTimes(1);
      expect(stub.tryFindApiKeyOwner).toHaveBeenCalledTimes(1);
      // Every project's team was given, so no scope needed resolving.
      expect(stub.tryFindProjectLineage).not.toHaveBeenCalled();
    });

    it("answers each permission per project from the same snapshot", async () => {
      const { byPermission } = await makeAuthz(reader()).canBatchPermissionsByIds({
        principal: key,
        permissions: ["traces:view", "cost:view"],
        organizationId: ORG,
        teams: [],
        projects: manyProjects(3),
      });

      const traces = byPermission.get("traces:view")?.projects;
      const cost = byPermission.get("cost:view")?.projects;
      // ADMIN grants both; VIEWER grants viewing but not pricing; a project
      // with no binding grants nothing.
      expect(traces?.get("proj-0")).toBe(true);
      expect(traces?.get("proj-1")).toBe(true);
      expect(traces?.get("proj-2")).toBe(false);
      expect(cost?.get("proj-0")).toBe(true);
      expect(cost?.get("proj-1")).toBe(false);
      expect(cost?.get("proj-2")).toBe(false);
    });

    it("answers exactly what the single-permission batch answers", async () => {
      const authz = makeAuthz(reader());
      const projects = manyProjects(3);

      const single = await authz.canBatchByIds({
        principal: key,
        permission: "cost:view",
        organizationId: ORG,
        teams: [],
        projects,
      });
      const multi = await authz.canBatchPermissionsByIds({
        principal: key,
        permissions: ["cost:view"],
        organizationId: ORG,
        teams: [],
        projects,
      });

      expect(single.projects).toEqual(multi.byPermission.get("cost:view")?.projects);
    });
  });

  describe("given a key bound admin whose owner is only a viewer", () => {
    const reader = () =>
      makeReader({
        tryFindApiKeyOwner: vi.fn().mockResolvedValue({ userId: "dave" }),
        findApiKeyBindings: vi.fn().mockResolvedValue([binding("ADMIN", "proj-0")]),
        tryFindOrganizationMembership: vi
          .fn()
          .mockResolvedValue({ role: "MEMBER", disabled: false }),
        findUserBindings: vi.fn().mockResolvedValue([binding("VIEWER", "proj-0")]),
      });

    it("caps every batched decision at the owner's grants", async () => {
      const { byPermission } = await makeAuthz(reader()).canBatchPermissionsByIds({
        principal: key,
        permissions: ["traces:view", "cost:view"],
        organizationId: ORG,
        teams: [],
        projects: [{ projectId: "proj-0", teamId: "team-0" }],
      });

      // The owner holds traces:view through VIEWER but not cost:view, so the
      // key's ADMIN binding is capped exactly as the single check caps it.
      expect(byPermission.get("traces:view")?.projects.get("proj-0")).toBe(true);
      expect(byPermission.get("cost:view")?.projects.get("proj-0")).toBe(false);
    });

    it("collects the owner's grants once, off the same pass", async () => {
      const stub = reader();

      await makeAuthz(stub).canBatchPermissionsByIds({
        principal: key,
        permissions: ["traces:view", "cost:view"],
        organizationId: ORG,
        teams: [],
        projects: manyProjects(25),
      });

      expect(stub.findUserBindings).toHaveBeenCalledTimes(1);
      expect(stub.findApiKeyBindings).toHaveBeenCalledTimes(1);
    });
  });
});
