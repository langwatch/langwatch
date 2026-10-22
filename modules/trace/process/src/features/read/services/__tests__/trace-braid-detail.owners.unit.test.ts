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

describe("TraceBraidDetailService.describeSpans", () => {
  describe("given the reader's spans and a braided span", () => {
    it("describes the braided span only, aligned with the spans given", async () => {
      const described = await TraceBraidDetailService.create({ directory: null }).describeSpans({
        readerProjectId: "proj_orchestrator",
        viewerUserId: "sam",
        spans: [
          { startedAtMs: 1 },
          { ownerProjectId: "proj_specialists", startedAtMs: 2 },
          { startedAtMs: 3 },
        ],
      });

      expect(described).toEqual([
        null,
        {
          ownerProjectId: "proj_specialists",
          ownerName: "proj_specialists",
          ownerProjectSlug: null,
          canOpenOwner: false,
          matchedConditions: [],
          signedBy: null,
        },
        null,
      ]);
    });
  });
});

describe("TraceBraidDetailService signing", () => {
  const signing = TraceBraidDetailService.create({
    directory: {
      authz: createApiFixture<AuthzApi>({
        hasPermission: async () => false,
        listBraids: async () => ({ intoOtherProjects: [], fromOtherProjects: [] }),
      }),
      projects: createApiFixture<ProjectApi>({
        findSummaryById: async (projectId) =>
          projectId === "proj_orchestrator" ? { name: "Orchestrator", slug: "orchestrator" } : null,
      }),
    },
  });
  const span = (signingProjectIds?: string[]) => ({
    readerProjectId: "proj_orchestrator",
    ownerProjectId: "proj_specialists",
    viewerUserId: "sam",
    spanStartedAtMs: 1,
    ...(signingProjectIds === undefined ? {} : { signingProjectIds }),
  });

  describe("given a braided span whose verified mark names the reader", () => {
    /** @scenario "A braided span from a signed call says who signed it" */
    it("says the reader signed it, by name", async () => {
      const braid = await signing.describe(span(["proj_orchestrator"]));

      expect(braid.signedBy).toEqual({ projectId: "proj_orchestrator", name: "Orchestrator" });
    });

    it("says so on the same span in a list read", async () => {
      const [braid] = await signing.describeSpans({
        readerProjectId: "proj_orchestrator",
        viewerUserId: "sam",
        spans: [
          {
            ownerProjectId: "proj_specialists",
            startedAtMs: 1,
            signingProjectIds: ["proj_orchestrator"],
          },
        ],
      });

      expect(braid?.signedBy).toEqual({ projectId: "proj_orchestrator", name: "Orchestrator" });
    });
  });

  describe("given a braided span with no mark, or a mark naming another project", () => {
    /** @scenario "A braided span from a signed call says who signed it" */
    it("says nothing about signing", async () => {
      expect((await signing.describe(span())).signedBy).toBeNull();
      expect((await signing.describe(span(["proj_elsewhere"]))).signedBy).toBeNull();
    });
  });
});
