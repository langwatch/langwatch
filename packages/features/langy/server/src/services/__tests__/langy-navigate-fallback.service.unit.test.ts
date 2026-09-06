/**
 * The navigate fallback's page half, under the asking project's own slug.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { describe, expect, it } from "vitest";
import { LangyNavigateProjectPort } from "../../ports/langy-navigate-project.port";
import { LangyNavigateResourcePort } from "../../ports/langy-navigate-resource.port";
import type { LangyNavigateResourceKind } from "../../rules/langy-navigate-resources.rules";
import { LangyNavigateFallbackService } from "../langy-navigate-fallback.service";

class FakeProjects extends LangyNavigateProjectPort {
  constructor(private readonly slugs: Record<string, string>) {
    super();
  }
  trySlugOf(projectId: string): Promise<string | null> {
    return Promise.resolve(this.slugs[projectId] ?? null);
  }
}

class FakeResources extends LangyNavigateResourcePort {
  readonly lookups: Array<{ kind: LangyNavigateResourceKind; resourceId: string }> = [];

  constructor(private readonly answer: (kind: LangyNavigateResourceKind) => string | null) {
    super();
  }

  async tryLocate(input: {
    projectId: string;
    kind: LangyNavigateResourceKind;
    resourceId: string;
  }): Promise<string | null> {
    this.lookups.push({ kind: input.kind, resourceId: input.resourceId });
    return this.answer(input.kind);
  }
}

const service = (
  slugs: Record<string, string> = { "project-1": "acme" },
  resources?: LangyNavigateResourcePort,
) =>
  LangyNavigateFallbackService.create({
    projects: new FakeProjects(slugs),
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    ...(resources ? { resources } : {}),
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

  describe("when the agent asks to open one resource by id", () => {
    it("looks the id up by the resource its prefix names and builds the address under the project", async () => {
      const resources = new FakeResources(() => "/prompts?promptId=prompt_abc");

      expect(
        await service({ "project-1": "acme" }, resources).tryResolveUrl({
          projectId: "project-1",
          resourceId: "prompt_abc",
        }),
      ).toBe("https://app.langwatch.test/acme/prompts?promptId=prompt_abc");
      expect(resources.lookups).toEqual([{ kind: "prompt", resourceId: "prompt_abc" }]);
    });

    it("drops the navigate and never reads the project when the id resolves to nothing", async () => {
      const resources = new FakeResources(() => null);

      expect(
        await service({}, resources).tryResolveUrl({
          projectId: "project-1",
          resourceId: "dataset_gone",
        }),
      ).toBeNull();
      expect(resources.lookups).toEqual([{ kind: "dataset", resourceId: "dataset_gone" }]);
    });

    it("never looks up an id whose prefix names no resource", async () => {
      const resources = new FakeResources(() => "/anywhere");

      expect(
        await service({ "project-1": "acme" }, resources).tryResolveUrl({
          projectId: "project-1",
          resourceId: "session_0002Gu9QAAAABBBB",
        }),
      ).toBeNull();
      expect(resources.lookups).toEqual([]);
    });

    it("drops the navigate rather than throwing when the lookup fails", async () => {
      const resources = new FakeResources(() => {
        throw new Error("clickhouse down");
      });

      await expect(
        service({ "project-1": "acme" }, resources).tryResolveUrl({
          projectId: "project-1",
          resourceId: "scenariorun_1",
        }),
      ).resolves.toBeNull();
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
