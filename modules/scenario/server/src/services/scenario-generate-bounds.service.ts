import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/infrastructure/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScenarioGenerateRateLimitedError } from "@langwatch/scenario-contract";

/**
 * The tier-effective window the author-assist generates under: one generation
 * is a model call the project pays for, so the counter is the project's
 * window at the caller's plan bound.
 */
export class ScenarioGenerateBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimiter: RateLimiter;
  }): ScenarioGenerateBoundsService {
    return new ScenarioGenerateBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimiter: RateLimiter;
    }>,
  ) {}

  /** Counts one generation against the project's window, before the model is resolved. */
  async assertGenerateWithinBounds(input: { projectId: string }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);

    const requests = await this.deps.entitlement.requestBound({
      key: "scenarioGeneratePerMinute",
      organizationId,
    });
    const decision = await this.deps.rateLimiter.check(`scenario-generate:${input.projectId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new ScenarioGenerateRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
