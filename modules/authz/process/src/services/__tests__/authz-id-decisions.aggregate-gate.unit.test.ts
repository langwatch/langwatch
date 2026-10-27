import { type CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { StubAuthzEpoch } from "../../repositories/__tests__/support/authz-epoch.stub.ts";
import { StubAuthzLineageEpoch } from "../../repositories/__tests__/support/authz-lineage-epoch.stub.ts";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { AuthzService } from "../authz.service.ts";

/** ADR-177 decision 5 (M8487-BATCH-GATE): a batch never admits what a single check refuses. */

const ORG = "org-1";
const PROJECT = "proj-aggregate";
const alice = { type: "user", id: "alice" } as const;
const aliceKey = { type: "apiKey", id: "key-1" } as const;
const admin: CollectedBinding[] = [
  { roleKey: "admin", scopeType: "PROJECT", scopeId: PROJECT, viaGroupId: null },
];

function makeAuthz({ role, kind }: { role: "ADMIN" | "MEMBER"; kind: string }) {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader({
      findOrganizationMembership: vi.fn().mockResolvedValue({ role, disabled: false }),
      findUserBindings: vi.fn().mockResolvedValue(admin),
      findApiKeyBindings: vi.fn().mockResolvedValue(admin),
      findApiKeyOwner: vi.fn().mockResolvedValue({ userId: alice.id }),
      findProjectLineage: vi
        .fn()
        .mockResolvedValue({ teamId: "team-1", organizationId: ORG, kind }),
      findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    }),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
    epoch: new StubAuthzEpoch(),
    lineageEpochs: new StubAuthzLineageEpoch(),
    cacheEnabled: () => false,
  });
}

async function askBatchPaths(
  authz: AuthzService,
  principal: typeof alice | typeof aliceKey = alice,
) {
  const anyOf = await authz.canAnyByIds({
    principal,
    permissions: ["traces:view"],
    projectId: PROJECT,
  });
  const batch = await authz.canBatchPermissionsByIds({
    principal,
    permissions: ["traces:view"],
    organizationId: ORG,
    teams: [],
    projects: [{ projectId: PROJECT, teamId: "team-1" }],
  });
  return [anyOf.allowed, batch.byPermission.get("traces:view")?.projects.get(PROJECT)];
}

describe("AuthzService batch decisions on an aggregate project", () => {
  describe("when a permitted member who is not an organization admin asks", () => {
    it("closes the aggregate in canAnyByIds and canBatchPermissionsByIds", async () => {
      const authz = makeAuthz({ role: "MEMBER", kind: "aggregate" });

      expect(await askBatchPaths(authz)).toEqual([false, false]);
    });

    it("leaves an ordinary project open", async () => {
      const authz = makeAuthz({ role: "MEMBER", kind: "project" });

      expect(await askBatchPaths(authz)).toEqual([true, true]);
    });
  });

  describe("when an organization admin asks", () => {
    it("opens the aggregate", async () => {
      const authz = makeAuthz({ role: "ADMIN", kind: "aggregate" });

      expect(await askBatchPaths(authz)).toEqual([true, true]);
    });
  });

  describe("when an api key asks", () => {
    it("acts with its owner's role, so a member's key is closed out", async () => {
      const authz = makeAuthz({ role: "MEMBER", kind: "aggregate" });

      expect(await askBatchPaths(authz, aliceKey)).toEqual([false, false]);
    });
  });
});
