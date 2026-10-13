/**
 * Resolution for a navigate destination with no remembered platform link. The
 * address is STILL platform-computed, never agent-authored; an unknown id, a missing
 * project or a failed resource lookup drops the navigate, not the relay stream.
 */
import type { ProjectApi } from "@langwatch/project-contract";

import { pickNavigatePage } from "../rules/langy-navigate-pages.rules.ts";
import { detectNavigateResourceKind } from "../rules/langy-navigate-resources.rules.ts";
import {
  langyOrganizationPlatformUrl,
  langyProjectPlatformUrl,
} from "../rules/langy-platform-url.rules.ts";
import type {
  LangyNavigateResourceLocation,
  LangyNavigateResourceLocatorService,
} from "./langy-navigate-resource-locator.service.ts";

/** The platform address a navigate opens, or `dropped` when nothing answers to the id. */
type LangyNavigateResolution = { outcome: "resolved"; url: string } | { outcome: "dropped" };

const DROPPED: LangyNavigateResolution = { outcome: "dropped" };

type LangyNavigateFallbackDeps = {
  projects: Pick<ProjectApi, "findSummaryById">;
  resources: Pick<LangyNavigateResourceLocatorService, "locate">;
  publicBaseUrl: string | undefined;
};

export class LangyNavigateFallbackService {
  static create(deps: LangyNavigateFallbackDeps): LangyNavigateFallbackService {
    return new LangyNavigateFallbackService(deps);
  }

  readonly #projects: LangyNavigateFallbackDeps["projects"];
  readonly #resources: LangyNavigateFallbackDeps["resources"];
  readonly #publicBaseUrl: string | undefined;

  private constructor(deps: LangyNavigateFallbackDeps) {
    this.#projects = deps.projects;
    this.#resources = deps.resources;
    this.#publicBaseUrl = deps.publicBaseUrl;
  }

  async resolveUrl(input: {
    projectId: string;
    resourceId: string;
  }): Promise<LangyNavigateResolution> {
    const publicBaseUrl = this.#publicBaseUrl;
    const page = pickNavigatePage(input.resourceId);
    if (page?.scope === "organization") {
      return {
        outcome: "resolved",
        url: langyOrganizationPlatformUrl({ publicBaseUrl, path: page.path }),
      };
    }

    const location: LangyNavigateResourceLocation = page
      ? {
          outcome: "located",
          address: (projectSlug) =>
            Promise.resolve(
              langyProjectPlatformUrl({ publicBaseUrl, projectSlug, path: page.path }),
            ),
        }
      : await this.#locateResource(input);
    if (location.outcome === "unknown") {
      return DROPPED;
    }

    // The slug is fetched once, and only after the destination is confirmed:
    // an id that resolves to nothing never costs a project read.
    const project = await this.#projects.findSummaryById(input.projectId);
    if (!project?.slug) {
      return DROPPED;
    }
    return { outcome: "resolved", url: await location.address(project.slug) };
  }

  async #locateResource({
    projectId,
    resourceId,
  }: {
    projectId: string;
    resourceId: string;
  }): Promise<LangyNavigateResourceLocation> {
    const kind = detectNavigateResourceKind(resourceId);
    if (!kind) {
      return { outcome: "unknown" };
    }

    // A failed lookup drops the navigate rather than the relay stream (see the header).
    return this.#resources
      .locate({ projectId, kind, resourceId })
      .catch((): LangyNavigateResourceLocation => ({ outcome: "unknown" }));
  }
}
