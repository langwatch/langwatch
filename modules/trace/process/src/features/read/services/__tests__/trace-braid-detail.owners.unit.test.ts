/**
 * The owners the trace header names (ADR-183 §5). Spec: modules/trace/specs/braided-spans.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceBraidDetailService } from "../trace-braid-detail.service.ts";

const projects = createApiFixture<ProjectApi>({
  findSummaryById: async (projectId) =>
    projectId === "proj_specialists" ? { name: "Specialists", slug: "specialists" } : null,
});

function detailFor({ readable }: { readable: string[] }) {
  const authz = createApiFixture<AuthzApi>({
    hasPermission: async (check) =>
      "projectId" in check && typeof check.projectId === "string"
        ? readable.includes(check.projectId)
        : false,
  });
  return TraceBraidDetailService.create({ directory: { authz, projects } });
}

describe("TraceBraidDetailService.describeOwners", () => {
  describe("given a viewer with no role on the owner", () => {
    /** @scenario "A braided span carries a badge naming its owning project" */
    it("names the owner without offering to open it", async () => {
      const owners = await detailFor({ readable: [] }).describeOwners({
        ownerProjectIds: ["proj_specialists"],
        viewerUserId: "sam",
      });

      expect(owners).toEqual([
        { projectId: "proj_specialists", name: "Specialists", canOpen: false, slug: null },
      ]);
    });
  });

  describe("given a viewer who can read the owner", () => {
    it("offers the owner's slug, keeping the order given", async () => {
      const owners = await detailFor({ readable: ["proj_specialists"] }).describeOwners({
        ownerProjectIds: ["proj_specialists", "proj_gone"],
        viewerUserId: "sam",
      });

      expect(owners).toEqual([
        { projectId: "proj_specialists", name: "Specialists", canOpen: true, slug: "specialists" },
        { projectId: "proj_gone", name: "proj_gone", canOpen: false, slug: null },
      ]);
    });
  });
});
