/**
 * Resolution for a navigate destination with no remembered platform link. The
 * address is STILL platform-computed, never agent-authored; anything unknown
 * or failing resolves to null rather than tearing down the relay stream.
 */
import {
  type LangyNavigateProject,
  type LangyNavigateResourceLocator,
} from "../app/langy.members.ts";
import { navigatePageFor } from "../rules/langy-navigate-pages.rules.ts";
import { navigateResourceKindFor } from "../rules/langy-navigate-resources.rules.ts";

/** Builds a deep link into the product from a project slug and a path. */
export type LangyNavigatePlatformUrl = (input: { projectSlug: string; path: string }) => string;

/** Builds a deep link to an organization page, which sits at the top level. */
export type LangyNavigateOrganizationUrl = (input: { path: string }) => string;

export class LangyNavigateFallbackService {
  private constructor(
    private readonly projects: LangyNavigateProject,
    private readonly platformUrl: LangyNavigatePlatformUrl,
    private readonly organizationUrl: LangyNavigateOrganizationUrl,
    private readonly resources: LangyNavigateResourceLocator | undefined,
  ) {}

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
    return new LangyNavigateFallbackService(
      deps.projects,
      deps.platformUrl,
      deps.organizationUrl,
      deps.resources,
    );
  }

  /**
   * The platform address this id names, or null when nothing in this project
   * answers to it.
   */
  async tryResolveUrl(input: { projectId: string; resourceId: string }): Promise<string | null> {
    const page = navigatePageFor(input.resourceId);
    if (page?.scope === "organization") {
      return this.organizationUrl({ path: page.path });
    }

    const path = page?.path ?? (await this.tryResolveResourcePath(input));
    if (!path) {
      return null;
    }

    // The slug is fetched once, and only after the destination is confirmed:
    // an id that resolves to nothing never costs a project read.
    const projectSlug = await this.projects.trySlugOf(input.projectId).catch(() => null);
    if (!projectSlug) {
      return null;
    }

    return this.platformUrl({ projectSlug, path });
  }

  private async tryResolveResourcePath({
    projectId,
    resourceId,
  }: {
    projectId: string;
    resourceId: string;
  }): Promise<string | null> {
    const kind = navigateResourceKindFor(resourceId);
    if (!kind || !this.resources) {
      return null;
    }

    return this.resources.tryLocate({ projectId, kind, resourceId }).catch(() => null);
  }
}
