/**
 * Resolution for a navigate destination the conversation remembered no platform
 * link for. The address is STILL platform-computed, never agent-authored, and
 * anything the page table does not know resolves to null so the navigate drops.
 */
import type { LangyNavigateProjectPort } from "../ports/langy-navigate-project.port";
import { navigatePagePathFor } from "../rules/langy-navigate-pages.rules";

/** Builds a deep link into the product from a project slug and a path. */
export type LangyNavigatePlatformUrl = (input: { projectSlug: string; path: string }) => string;

export class LangyNavigateFallbackService {
  private constructor(
    private readonly projects: LangyNavigateProjectPort,
    private readonly platformUrl: LangyNavigatePlatformUrl,
  ) {}

  static create(deps: {
    projects: LangyNavigateProjectPort;
    platformUrl: LangyNavigatePlatformUrl;
  }): LangyNavigateFallbackService {
    return new LangyNavigateFallbackService(deps.projects, deps.platformUrl);
  }

  /**
   * The platform address this id names, or null when nothing in this project
   * answers to it. A lookup that fails resolves to null rather than tearing
   * down the relay stream.
   */
  async tryResolveUrl(input: { projectId: string; resourceId: string }): Promise<string | null> {
    const path = navigatePagePathFor(input.resourceId);
    if (!path) {
      return null;
    }

    const projectSlug = await this.projects.trySlugOf(input.projectId).catch(() => null);
    if (!projectSlug) {
      return null;
    }

    return this.platformUrl({ projectSlug, path });
  }
}
