import { LangWatchQLRateLimitedError } from "@langwatch/analytics-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { AnalyticsRateLimitRepository } from "../repositories/analytics-rate-limit.repository.ts";

/** The label a background refusal counts under, beside people's `lwql`. */
const BACKGROUND_SCOPE = "lwql_background";

/**
 * The tier-effective window every LangWatchQL execution runs under: a query
 * loop burns compute invoiced to the project, so the counter is the
 * project's window at the bound the caller's plan answers.
 */
export class LangWatchQLBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimits: AnalyticsRateLimitRepository;
  }): LangWatchQLBoundsService {
    return new LangWatchQLBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimits: AnalyticsRateLimitRepository;
    }>,
  ) {}

  /** Counts one execution against the project's window, before the statement runs. */
  assertQueryWithinBounds(input: { projectId: string }): Promise<void> {
    return this.#admit({ projectId: input.projectId, share: (bound) => bound });
  }

  /**
   * Counts one execution with nobody waiting against the same window, refused once it holds a
   * third of the bound, whoever used it, so people reading boards keep the rest. Its refusals
   * pace the check, so they are counted apart from people's.
   */
  assertBackgroundQueryWithinBounds(input: { projectId: string }): Promise<void> {
    return this.#admit({
      projectId: input.projectId,
      share: (bound) => Math.max(1, Math.floor(bound / 3)),
      scope: BACKGROUND_SCOPE,
    });
  }

  async #admit(input: {
    projectId: string;
    share: (bound: number) => number;
    scope?: string;
  }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);

    const bound = await this.deps.entitlement.requestBound({
      key: "lwqlPerMinute",
      organizationId,
    });
    const decision = await this.deps.rateLimits.check(`lwql:${input.projectId}`, {
      requests: input.share(bound),
      seconds: 60,
      ...(input.scope ? { scope: input.scope } : {}),
    });
    if (!decision.allowed) {
      throw new LangWatchQLRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
