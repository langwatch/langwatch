/**
 * Resolution for a navigate destination with no remembered platform link. The
 * address is STILL platform-computed, never agent-authored; anything unknown
 * or failing resolves to null rather than tearing down the relay stream.
 */
import type { LangyNavigateProject } from "../app/langy.infrastructure.ts";
import type { LangyNavigateResource } from "../app/langy.infrastructure.ts";
import { navigatePagePathFor } from "../rules/langy-navigate-pages.rules.ts";
import { navigateResourceKindFor } from "../rules/langy-navigate-resources.rules.ts";

/** Builds a deep link into the product from a project slug and a path. */
export type LangyNavigatePlatformUrl = (input: { projectSlug: string; path: string }) => string;

export class LangyNavigateFallbackService {
  private constructor(
    private readonly projects: LangyNavigateProject,
    private readonly platformUrl: LangyNavigatePlatformUrl,
    private readonly resources: LangyNavigateResource | undefined,
  ) {}

  static create(deps: {
    projects: LangyNavigateProject;
    platformUrl: LangyNavigatePlatformUrl;
    /**
     * Absent where a process composed none of the eight features a resource id
     * names; only page names resolve then.
     */
    resources?: LangyNavigateResource;
  }): LangyNavigateFallbackService {
    return new LangyNavigateFallbackService(deps.projects, deps.platformUrl, deps.resources);
  }

  /**
   * The platform address this id names, or null when nothing in this project
   * answers to it.
   */
  async tryResolveUrl(input: { projectId: string; resourceId: string }): Promise<string | null> {
    const path = await this.tryResolvePath(input);
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

  private async tryResolvePath({
    projectId,
    resourceId,
  }: {
    projectId: string;
    resourceId: string;
  }): Promise<string | null> {
    const pagePath = navigatePagePathFor(resourceId);
    if (pagePath) {
      return pagePath;
    }

    const kind = navigateResourceKindFor(resourceId);
    if (!kind || !this.resources) {
      return null;
    }

    return await this.resources.tryLocate({ projectId, kind, resourceId }).catch(() => null);
  }
}
