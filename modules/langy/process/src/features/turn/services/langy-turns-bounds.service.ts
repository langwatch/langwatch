import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { LangyTurnsRateLimitedError } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { LangyRateLimitRepository } from "../../../repositories/langy-rate-limit.repository.ts";

/**
 * The tier-effective window every Langy turn starts under. A turn dispatches
 * agent work the project pays for, so the counter is the project's fixed
 * window at the bound the caller's plan answers through the entitlement peer.
 */
export class LangyTurnsBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimits: LangyRateLimitRepository;
  }): LangyTurnsBoundsService {
    return new LangyTurnsBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimits: LangyRateLimitRepository;
    }>,
  ) {}

  /** Counts one turn against the project's window, before the turn is dispatched. */
  assertTurnWithinBounds(input: { projectId: string }): Promise<void> {
    return this.count({ ...input, key: "langyTurnsPerMinute", counter: "langy-turn" });
  }

  /**
   * Counts one unattended turn against a smaller window of its own, so scheduled runs never
   * spend the window people chatting with Langy start their turns under.
   */
  assertUnattendedTurnWithinBounds(input: { projectId: string }): Promise<void> {
    return this.count({
      ...input,
      key: "langyUnattendedTurnsPerMinute",
      counter: "langy-unattended-turn",
    });
  }

  private async count({
    projectId,
    key,
    counter,
  }: {
    projectId: string;
    key: "langyTurnsPerMinute" | "langyUnattendedTurnsPerMinute";
    counter: string;
  }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(projectId);

    const requests = await this.deps.entitlement.requestBound({ key, organizationId });
    const decision = await this.deps.rateLimits.check(`${counter}:${projectId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new LangyTurnsRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
