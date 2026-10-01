/**
 * The navigate fallback's page half, under the asking project's own slug.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type { LangyNavigateResourceKind } from "../../rules/langy-navigate-resources.rules.ts";
import { LangyNavigateFallbackService } from "../langy-navigate-fallback.service.ts";
import type {
  LangyNavigateResourceLocation,
  LangyNavigateResourceLocatorService,
} from "../langy-navigate-resource-locator.service.ts";

function projectsWith(slugs: Record<string, string>) {
  return createApiFixture<ProjectApi>({
    findSummaryById: async (projectId: string) => {
      const slug = slugs[projectId];
      return slug === undefined ? null : { name: slug, slug };
    },
  });
}

class FakeResources implements Pick<LangyNavigateResourceLocatorService, "locate"> {
  readonly lookups: { kind: LangyNavigateResourceKind; resourceId: string }[] = [];

  constructor(private readonly answer: (kind: LangyNavigateResourceKind) => string | null) {}

  async locate(input: {
    projectId: string;
    kind: LangyNavigateResourceKind;
    resourceId: string;
  }): Promise<LangyNavigateResourceLocation> {
    this.lookups.push({ kind: input.kind, resourceId: input.resourceId });
    const path = this.answer(input.kind);
    return path === null
      ? { outcome: "unknown" }
      : {
          outcome: "located",
          address: (projectSlug) =>
            Promise.resolve(`https://app.langwatch.test/${projectSlug}${path}`),
        };
  }
}

const service = (
  slugs: Record<string, string> = { "project-1": "acme" },
  resources: Pick<LangyNavigateResourceLocatorService, "locate"> = new FakeResources(() => null),
) =>
  LangyNavigateFallbackService.create({
    projects: projectsWith(slugs),
    resources,
    publicBaseUrl: "https://app.langwatch.test/",
  });

describe("LangyNavigateFallbackService", () => {
  describe("when the agent asks to open a page rather than one resource", () => {
    /** @scenario A page name navigates to the project's own page */
    it("resolves a page name to the project's own page address", async () => {
      expect(await service().resolveUrl({ projectId: "project-1", resourceId: "prompts" })).toEqual(
        { outcome: "resolved", url: "https://app.langwatch.test/acme/prompts" },
      );

      expect(
        await service().resolveUrl({ projectId: "project-1", resourceId: "online-evaluations" }),
      ).toEqual({ outcome: "resolved", url: "https://app.langwatch.test/acme/online-evaluations" });
    });

    it("reads a page name the agent typed in any case", async () => {
      expect(await service().resolveUrl({ projectId: "project-1", resourceId: "Prompts" })).toEqual(
        { outcome: "resolved", url: "https://app.langwatch.test/acme/prompts" },
      );
    });
  });

  describe("when the agent asks for the governance sources page", () => {
    /** @scenario "An organization page opens at the top level, outside the project" */
    it("resolves the inventory page on its sources tab at the top level, with no project slug", async () => {
      expect(
        await service({}).resolveUrl({
          projectId: "project-1",
          resourceId: "governance-sources",
        }),
      ).toEqual({
        outcome: "resolved",
        url: "https://app.langwatch.test/governance/inventory?tab=sources",
      });
    });
  });

  describe("when the agent asks to open one resource by id", () => {
    it("looks the id up by the resource its prefix names and builds the address under the project", async () => {
      const resources = new FakeResources(() => "/prompts?promptId=prompt_abc");

      expect(
        await service({ "project-1": "acme" }, resources).resolveUrl({
          projectId: "project-1",
          resourceId: "prompt_abc",
        }),
      ).toEqual({
        outcome: "resolved",
        url: "https://app.langwatch.test/acme/prompts?promptId=prompt_abc",
      });
      expect(resources.lookups).toEqual([{ kind: "prompt", resourceId: "prompt_abc" }]);
    });

    /** @scenario "A scenario opens in its editor through the platform fallback" */
    it("looks a scenario id up as a scenario, not as a scenario run", async () => {
      const editor =
        "/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1";
      const resources = new FakeResources(() => editor);

      expect(
        await service({ "project-1": "acme" }, resources).resolveUrl({
          projectId: "project-1",
          resourceId: "scenario_1",
        }),
      ).toEqual({ outcome: "resolved", url: `https://app.langwatch.test/acme${editor}` });
      expect(resources.lookups).toEqual([{ kind: "scenario", resourceId: "scenario_1" }]);
    });

    it("drops the navigate and never reads the project when the id resolves to nothing", async () => {
      const resources = new FakeResources(() => null);

      expect(
        await service({}, resources).resolveUrl({
          projectId: "project-1",
          resourceId: "dataset_gone",
        }),
      ).toEqual({ outcome: "dropped" });
      expect(resources.lookups).toEqual([{ kind: "dataset", resourceId: "dataset_gone" }]);
    });

    it("never looks up an id whose prefix names no resource", async () => {
      const resources = new FakeResources(() => "/anywhere");

      expect(
        await service({ "project-1": "acme" }, resources).resolveUrl({
          projectId: "project-1",
          resourceId: "session_0002Gu9QAAAABBBB",
        }),
      ).toEqual({ outcome: "dropped" });
      expect(resources.lookups).toEqual([]);
    });

    it("drops the navigate rather than throwing when the lookup fails", async () => {
      const resources = new FakeResources(() => {
        throw new Error("clickhouse down");
      });

      await expect(
        service({ "project-1": "acme" }, resources).resolveUrl({
          projectId: "project-1",
          resourceId: "scenariorun_1",
        }),
      ).resolves.toEqual({ outcome: "dropped" });
    });
  });
  describe("when the name is not a page this project can open", () => {
    /** @scenario A name outside the page set is not a destination */
    it("drops a word that is neither a page nor a resolvable id", async () => {
      expect(
        await service().resolveUrl({ projectId: "project-1", resourceId: "settings" }),
      ).toEqual({ outcome: "dropped" });
    });

    it("drops the navigate when the asking project is missing", async () => {
      expect(
        await service({}).resolveUrl({ projectId: "project-1", resourceId: "prompts" }),
      ).toEqual({ outcome: "dropped" });
    });

    it("lets a project read failure through", async () => {
      const failing = LangyNavigateFallbackService.create({
        projects: createApiFixture<ProjectApi>({
          findSummaryById: () => Promise.reject(new Error("postgres down")),
        }),
        resources: new FakeResources(() => null),
        publicBaseUrl: "https://app.langwatch.test",
      });

      await expect(
        failing.resolveUrl({ projectId: "project-1", resourceId: "prompts" }),
      ).rejects.toThrow("postgres down");
    });
  });
});
