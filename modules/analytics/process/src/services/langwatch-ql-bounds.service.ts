import { LangWatchQLRateLimitedError } from "@langwatch/analytics-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The tier-effective window every LangWatchQL execution runs under: a query
 * loop burns compute invoiced to the project, so the counter is the
 * project's window at the bound the caller's plan answers.
 */
export class LangWatchQLBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimiter: RateLimiter;
  }): LangWatchQLBoundsService {
    return new LangWatchQLBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimiter: RateLimiter;
    }>,
  ) {}

  /** Counts one execution against the project's window, before the statement runs. */
  async assertQueryWithinBounds(input: { projectId: string }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);

    const requests = await this.deps.entitlement.requestBound({
      key: "lwqlPerMinute",
      organizationId,
    });
    const decision = await this.deps.rateLimiter.check(`lwql:${input.projectId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new LangWatchQLRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
