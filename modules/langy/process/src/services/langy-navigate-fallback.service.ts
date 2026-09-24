/**
 * Resolution for a navigate destination with no remembered platform link. The
 * address is STILL platform-computed, never agent-authored; an unknown id, a missing
 * project or a failed resource lookup drops the navigate, not the relay stream.
 */
import { HandledError } from "@langwatch/handled-error";

import {
  type LangyNavigateProject,
  type LangyNavigateResourceLocation,
  type LangyNavigateResourceLocator,
} from "../app/langy.members.ts";
import { pickNavigatePage } from "../rules/langy-navigate-pages.rules.ts";
import { detectNavigateResourceKind } from "../rules/langy-navigate-resources.rules.ts";

/** Builds a deep link into the product from a project slug and a path. */
export type LangyNavigatePlatformUrl = (input: { projectSlug: string; path: string }) => string;

/** Builds a deep link to an organization page, which sits at the top level. */
export type LangyNavigateOrganizationUrl = (input: { path: string }) => string;

/** The platform address a navigate opens, or `dropped` when nothing answers to the id. */
export type LangyNavigateResolution = { outcome: "resolved"; url: string } | { outcome: "dropped" };

const DROPPED: LangyNavigateResolution = { outcome: "dropped" };

export class LangyNavigateFallbackService {
  private readonly projects: LangyNavigateProject;
  private readonly platformUrl: LangyNavigatePlatformUrl;
  private readonly organizationUrl: LangyNavigateOrganizationUrl;
  private readonly resources: LangyNavigateResourceLocator | undefined;

  private constructor({
    projects,
    platformUrl,
    organizationUrl,
    resources,
  }: {
    projects: LangyNavigateProject;
    platformUrl: LangyNavigatePlatformUrl;
    organizationUrl: LangyNavigateOrganizationUrl;
    resources: LangyNavigateResourceLocator | undefined;
  }) {
    this.projects = projects;
    this.platformUrl = platformUrl;
    this.organizationUrl = organizationUrl;
    this.resources = resources;
  }

  static create(deps: {
    projects: LangyNavigateProject;
    platformUrl: LangyNavigatePlatformUrl;
    organizationUrl: LangyNavigateOrganizationUrl;
    /**
     * Absent where a process composed none of the eight features a resource id
     * names; only page names resolve then.
     */
    resources?: LangyNavigateResourceLocator;
  }): LangyNavigateFallbackService {
    return new LangyNavigateFallbackService({
      projects: deps.projects,
      platformUrl: deps.platformUrl,
      organizationUrl: deps.organizationUrl,
      resources: deps.resources,
    });
  }

  async resolveUrl(input: {
    projectId: string;
    resourceId: string;
  }): Promise<LangyNavigateResolution> {
    const page = pickNavigatePage(input.resourceId);
    if (page?.scope === "organization") {
      return { outcome: "resolved", url: this.organizationUrl({ path: page.path }) };
    }

    const location = page
      ? { outcome: "located" as const, path: page.path }
      : await this.locateResource(input);
    if (location.outcome === "unknown") {
      return DROPPED;
    }

    // The slug is fetched once, and only after the destination is confirmed:
    // an id that resolves to nothing never costs a project read.
    try {
      const projectSlug = await this.projects.getSlug(input.projectId);
      return { outcome: "resolved", url: this.platformUrl({ projectSlug, path: location.path }) };
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "project_not_found") {
        return DROPPED;
      }
      throw error;
    }
  }

  private async locateResource({
    projectId,
    resourceId,
  }: {
    projectId: string;
    resourceId: string;
  }): Promise<LangyNavigateResourceLocation> {
    const kind = detectNavigateResourceKind(resourceId);
    if (!kind || !this.resources) {
      return { outcome: "unknown" };
    }

    // A failed lookup drops the navigate rather than the relay stream (see the header).
    return this.resources
      .locate({ projectId, kind, resourceId })
      .catch((): LangyNavigateResourceLocation => ({ outcome: "unknown" }));
  }
}
