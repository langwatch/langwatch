/**
 * The usage report's judge calls (ADR-189 Consequences): kept rows that a judge answered, which
 * a recall never adds, counted only for organizations with `release_instant_eval_results` on.
 * @see specs/self-hosting/connected-services/usage-report.feature
 */

import type { InstantEvalUsageCount } from "@langwatch/instant-eval-contract";

import type { EvalResultsRepository } from "../repositories/eval-results.repository.ts";

/** What this service asks of other modules, each narrowed to the one answer it needs. */
export interface EvalResultsUsagePeers {
  findOrganizationId(projectId: string): Promise<string | undefined>;
  /** Whether the organization keeps its results: `release_instant_eval_results`. */
  isReleasedForOrganization(input: { organizationId: string }): Promise<boolean>;
}

export class EvalResultsUsageService {
  private constructor(
    private readonly results: Pick<EvalResultsRepository, "countJudged">,
    private readonly peers: EvalResultsUsagePeers,
  ) {}

  static create({
    results,
    peers,
  }: {
    results: Pick<EvalResultsRepository, "countJudged">;
    peers: EvalResultsUsagePeers;
  }): EvalResultsUsageService {
    return new EvalResultsUsageService(results, peers);
  }

  /** Judge calls since `since` (epoch ms); left out where no organization keeps its results. */
  async countJudgeCalls({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<Pick<InstantEvalUsageCount, "judgeCalls">> {
    const released = await this.#releasedProjectIds(projectIds);
    if (released.length === 0) return {};

    return {
      judgeCalls: await this.results.countJudged({
        projectIds: released,
        ...(since === undefined ? {} : { since }),
      }),
    };
  }

  /** The projects whose organization has the flag on, asking each organization once. */
  async #releasedProjectIds(projectIds: readonly string[]): Promise<readonly string[]> {
    const releasedByOrganization = new Map<string, Promise<boolean>>();
    const projects = await Promise.all(
      [...new Set(projectIds)].map(async (projectId) => {
        const organizationId = await this.peers.findOrganizationId(projectId);
        if (organizationId === undefined) return [];
        const asked =
          releasedByOrganization.get(organizationId) ??
          this.peers.isReleasedForOrganization({ organizationId });
        releasedByOrganization.set(organizationId, asked);
        return (await asked) ? [projectId] : [];
      }),
    );
    return projects.flat();
  }
}
