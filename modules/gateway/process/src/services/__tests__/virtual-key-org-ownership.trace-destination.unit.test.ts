import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { VirtualKeyOrgOwnershipService } from "../../features/virtual-key/services/virtual-key-org-ownership.service.ts";
import { VirtualKeyAuthorizationRepository } from "../../repositories/virtual-key-authorization.repository.ts";

/** ADR-177 decision 7: an aggregate project owns no traces, so no key may send it any. */

class EmptyDirectory extends VirtualKeyAuthorizationRepository {
  async findProjectIdsForTeams() {
    return [];
  }
  async findTeamIdsInOrganization() {
    return [];
  }
  async findVirtualKeyScopes() {
    return null;
  }
  async findGuardrailIdsInProject() {
    return [];
  }
}

function ownershipWith({ kind }: { kind: string }) {
  return VirtualKeyOrgOwnershipService.create({
    directory: new EmptyDirectory(),
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => ["proj_1"],
      findTraceDestination: async (id) => ({ id, teamId: "team_1", archivedAt: null, kind }),
    }),
  });
}

describe("VirtualKeyOrgOwnershipService.assertTraceProjectBelongsToOrg", () => {
  describe("when the trace destination is an aggregate project", () => {
    it("refuses it as not a destination", async () => {
      await expect(
        ownershipWith({ kind: PROJECT_KIND.AGGREGATE }).assertTraceProjectBelongsToOrg({
          organizationId: "org_1",
          traceProjectId: "proj_1",
        }),
      ).rejects.toMatchObject({ code: "gateway_trace_project_not_a_destination" });
    });
  });

  describe("when the trace destination is an application project", () => {
    it("accepts it", async () => {
      await expect(
        ownershipWith({ kind: PROJECT_KIND.APPLICATION }).assertTraceProjectBelongsToOrg({
          organizationId: "org_1",
          traceProjectId: "proj_1",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the project belongs to another organization", () => {
    it("refuses it as a scope mismatch before reading its kind", async () => {
      await expect(
        ownershipWith({ kind: PROJECT_KIND.AGGREGATE }).assertTraceProjectBelongsToOrg({
          organizationId: "org_1",
          traceProjectId: "proj_elsewhere",
        }),
      ).rejects.toMatchObject({ code: "gateway_scope_org_mismatch" });
    });
  });
});
