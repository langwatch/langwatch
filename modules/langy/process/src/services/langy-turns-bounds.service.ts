import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import { LangyTurnsRateLimitedError } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The tier-effective window every Langy turn starts under. A turn dispatches
 * agent work the project pays for, so the counter is the project's fixed
 * window at the bound the caller's plan answers through the entitlement peer.
 */
export class LangyTurnsBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimiter: RateLimiter;
  }): LangyTurnsBoundsService {
    return new LangyTurnsBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimiter: RateLimiter;
    }>,
  ) {}

  /** Counts one turn against the project's window, before the turn is dispatched. */
  async assertTurnWithinBounds(input: { projectId: string }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);

    const requests = await this.deps.entitlement.requestBound({
      key: "langyTurnsPerMinute",
      organizationId,
    });
    const decision = await this.deps.rateLimiter.check(`langy-turn:${input.projectId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new LangyTurnsRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
