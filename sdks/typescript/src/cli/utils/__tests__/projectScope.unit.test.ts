/**
 * How a `--project <idOrSlug>` value becomes a project id: what answers
 * without a round trip, which match wins when an id and a slug could both
 * apply, and which failure the user is told about.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 */
import { describe, expect, it, vi } from "vitest";
import type {
  PaginatedProjects,
  Project,
  ProjectsApiService,
} from "@/client-sdk/services/projects/projects-api.service";
import { ProjectsApiError } from "@/client-sdk/services/projects/projects-api.service";
import { ProjectScopeError, resolveProjectSelector } from "../projectScope";

const project = (over: Partial<Project> & Pick<Project, "id" | "slug">): Project => ({
  name: over.slug,
  language: "python",
  framework: "langchain",
  teamId: "team_1",
  piiRedactionLevel: "ESSENTIAL",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** A listing service whose pages are whatever the test hands it. */
const listing = (
  pages: Project[][],
): { service: ProjectsApiService; list: ReturnType<typeof vi.fn> } => {
  const list = vi.fn(async ({ page }: { page?: number } = {}) => {
    const index = (page ?? 1) - 1;
    return {
      data: pages[index] ?? [],
      pagination: {
        page: page ?? 1,
        limit: 100,
        total: pages.flat().length,
        totalPages: pages.length,
      },
    } satisfies PaginatedProjects;
  });
  return { service: { list } as unknown as ProjectsApiService, list };
};

/** A listing service that fails with the given status. */
const failingListing = (status: number): ProjectsApiService =>
  ({
    list: vi.fn(async () => {
      throw new ProjectsApiError(
        "Failed to list projects",
        "list projects",
        undefined,
        status,
      );
    }),
  }) as unknown as ProjectsApiService;

const personalConfig = {
  gateway_url: "https://gateway.langwatch.ai",
  control_plane_url: "https://app.langwatch.ai",
  personal_project: { id: "proj_personal", slug: "personal-dev" },
};

describe("resolveProjectSelector()", () => {
  describe("when the value names the stored personal project", () => {
    it("answers from the stored config without listing anything", async () => {
      const { service, list } = listing([[]]);

      const resolved = await resolveProjectSelector({
        selector: "personal-dev",
        cfg: personalConfig,
        service,
      });

      expect(resolved).toBe("proj_personal");
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe("when the value names another project", () => {
    it("matches an id", async () => {
      const resolved = await resolveProjectSelector({
        selector: "proj-b",
        cfg: personalConfig,
        service: listing([[project({ id: "proj-b", slug: "checkout-agent" })]])
          .service,
      });

      expect(resolved).toBe("proj-b");
    });

    it("matches a slug", async () => {
      const resolved = await resolveProjectSelector({
        selector: "checkout-agent",
        cfg: personalConfig,
        service: listing([[project({ id: "proj-b", slug: "checkout-agent" })]])
          .service,
      });

      expect(resolved).toBe("proj-b");
    });

    it("prefers the id when one project's slug reads like another project's id", async () => {
      const resolved = await resolveProjectSelector({
        selector: "proj-b",
        cfg: personalConfig,
        service: listing([
          [
            project({ id: "proj-c", slug: "proj-b" }),
            project({ id: "proj-b", slug: "checkout-agent" }),
          ],
        ]).service,
      });

      expect(resolved).toBe("proj-b");
    });

    it("walks every page of the listing", async () => {
      const resolved = await resolveProjectSelector({
        selector: "checkout-agent",
        cfg: personalConfig,
        service: listing([
          [project({ id: "proj-a", slug: "alpha" })],
          [project({ id: "proj-b", slug: "checkout-agent" })],
        ]).service,
      });

      expect(resolved).toBe("proj-b");
    });
  });

  describe("when the value matches nothing the credential can see", () => {
    it("reports it as not accessible and echoes the value back", async () => {
      const failure = await resolveProjectSelector({
        selector: "someone-elses",
        cfg: personalConfig,
        service: listing([[project({ id: "proj-b", slug: "checkout-agent" })]])
          .service,
      }).catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(ProjectScopeError);
      expect((failure as ProjectScopeError).code).toBe(
        "project_not_accessible",
      );
      expect((failure as ProjectScopeError).project).toBe("someone-elses");
      expect((failure as ProjectScopeError).message).toContain(
        'no accessible project matches "someone-elses"',
      );
    });
  });

  describe("when the listing itself is refused", () => {
    it("reports a 403 as no access to that project", async () => {
      const failure = await resolveProjectSelector({
        selector: "proj-b",
        cfg: personalConfig,
        service: failingListing(403),
      }).catch((err: unknown) => err);

      expect((failure as ProjectScopeError).code).toBe(
        "project_not_accessible",
      );
      expect((failure as ProjectScopeError).message).toContain("proj-b");
    });

    it("keeps a server failure separate from a missing project", async () => {
      const failure = await resolveProjectSelector({
        selector: "proj-b",
        cfg: personalConfig,
        service: failingListing(500),
      }).catch((err: unknown) => err);

      // The credential may well reach this project; we simply could not ask.
      expect((failure as ProjectScopeError).code).toBe("project_lookup_failed");
    });
  });

  describe("when the organization has more projects than the page walk covers", () => {
    it("says the lookup failed rather than reporting the project as inaccessible", async () => {
      // One more page than the walk will read, so the cap is reached with
      // pages still to go. Answering "no accessible project matches" here
      // would be a wrong answer, not a slow one.
      const pages = Array.from({ length: 51 }, (_, index) => [
        project({ id: `proj-${index}`, slug: `project-${index}` }),
      ]);
      const { service } = listing(pages);

      const failure = await resolveProjectSelector({
        selector: "project-50",
        cfg: personalConfig,
        service,
      }).catch((err: unknown) => err);

      expect((failure as ProjectScopeError).code).toBe("project_lookup_failed");
      expect((failure as ProjectScopeError).message).toContain("5000");
    });
  });
});
