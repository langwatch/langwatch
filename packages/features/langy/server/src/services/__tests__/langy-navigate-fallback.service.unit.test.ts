/**
 * The navigate fallback's page half, under the asking project's own slug.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { describe, expect, it } from "vitest";
import { LangyNavigateProjectPort } from "../../ports/langy-navigate-project.port";
import { LangyNavigateFallbackService } from "../langy-navigate-fallback.service";

class FakeProjects extends LangyNavigateProjectPort {
  constructor(private readonly slugs: Record<string, string>) {
    super();
  }
  trySlugOf(projectId: string): Promise<string | null> {
    return Promise.resolve(this.slugs[projectId] ?? null);
  }
}

const service = (slugs: Record<string, string> = { "project-1": "acme" }) =>
  LangyNavigateFallbackService.create({
    projects: new FakeProjects(slugs),
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
  });

describe("LangyNavigateFallbackService", () => {
  describe("when the agent asks to open a page rather than one resource", () => {
    /** @scenario A page name navigates to the project's own page */
    it("resolves a page name to the project's own page address", async () => {
      expect(await service().tryResolveUrl({ projectId: "project-1", resourceId: "prompts" })).toBe(
        "https://app.langwatch.test/acme/prompts",
      );

      expect(
        await service().tryResolveUrl({ projectId: "project-1", resourceId: "online-evaluations" }),
      ).toBe("https://app.langwatch.test/acme/online-evaluations");
    });

    it("reads a page name the agent typed in any case", async () => {
      expect(await service().tryResolveUrl({ projectId: "project-1", resourceId: "Prompts" })).toBe(
        "https://app.langwatch.test/acme/prompts",
      );
    });
  });

  describe("when the name is not a page this project can open", () => {
    /** @scenario A name outside the page set is not a destination */
    it("returns null for a word that is neither a page nor a resolvable id", async () => {
      expect(
        await service().tryResolveUrl({ projectId: "project-1", resourceId: "settings" }),
      ).toBeNull();
    });

    it("returns null when the asking project has no readable slug", async () => {
      expect(
        await service({}).tryResolveUrl({ projectId: "project-1", resourceId: "prompts" }),
      ).toBeNull();
    });
  });
});
