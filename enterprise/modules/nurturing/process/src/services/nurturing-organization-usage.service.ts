// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import type {
  NurturingUsageOrganization,
  NurturingUsageOrganizationsRepository,
} from "../repositories/nurturing-usage-organizations.repository.ts";
import {
  type OrganizationUsage,
  USAGE_WINDOW_MS,
  usageGroupCall,
} from "../rules/nurturing-organization-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** One Customer.io batch per page: a group call is a few hundred bytes, far under its 500KB. */
const PAGE_SIZE = 100;

/** The claim is keyed by the UTC day, so it only has to outlive that day. */
const SYNCED_WINDOW_SECONDS = 2 * 24 * 60 * 60;

type OrganizationUsageDependencies = Readonly<{
  organizations: NurturingUsageOrganizationsRepository;
  projects: NurturingProjectDirectoryRepository;
  claims: NurturingClaimRepository;
  customerIo: NurturingService;
  prompts: PromptApi;
  evaluators: EvaluatorApi;
  scenarios: ScenarioApi;
  traces: TraceApi;
}>;

/**
 * Tells Customer.io each recently active organization's usage once per UTC day: one group call
 * to its admin, read from the owners. Each organization is claimed for the day before it is read;
 * a failed read or send gives its claims back and fails the sync, so the retry sends only those.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {}

  /** @throws Error when an organization's usage could not be read or sent; its claim is given back. */
  async syncAll({ now }: Readonly<{ now: number }>): Promise<void> {
    const since = now - USAGE_WINDOW_MS;
    const day = utcDayOf(now);
    let unsynced = 0;
    let afterId: string | undefined;
    for (;;) {
      const page = await this.dependencies.organizations.findRecentlyActive({
        since,
        limit: PAGE_SIZE,
        ...(afterId === undefined ? {} : { afterId }),
      });
      unsynced += await this.#syncPage({ page, since, day, now });
      const last = page.at(-1);
      if (page.length < PAGE_SIZE || !last) break;
      afterId = last.organizationId;
    }
    if (unsynced > 0) {
      throw new Error(`${unsynced} organizations' usage was not synced; their claims are given back`);
    }
  }

  /** Sends the page's unclaimed organizations in one batch; answers how many were not synced. */
  async #syncPage({
    page,
    since,
    day,
    now,
  }: Readonly<{
    page: readonly NurturingUsageOrganization[];
    since: number;
    day: string;
    now: number;
  }>): Promise<number> {
    const { claims, customerIo } = this.dependencies;
    const release = NurturingClaimReleaseService.create(claims);
    const claimed: string[] = [];
    const calls: CioBatchCall[] = [];
    let failed = 0;
    for (const { organizationId, adminUserId } of page) {
      const claimKey = `nurturing:organization_usage:${organizationId}:${day}`;
      if (!(await claims.claim(claimKey, SYNCED_WINDOW_SECONDS))) continue;
      try {
        const usage = await this.#usageOf({ organizationId, since });
        calls.push(usageGroupCall({ organizationId, adminUserId, usage, syncedAt: now }));
        claimed.push(claimKey);
      } catch (error) {
        failed++;
        const released = await release.releasedAll([claimKey]);
        nurturingLogger.error(
          { error, released, organizationId },
          "an organization's usage could not be read; its claim is given back",
        );
      }
    }
    if (calls.length === 0) return failed;
    try {
      await customerIo.batchOrThrow(calls);
    } catch (error) {
      const released = await release.releasedAll(claimed);
      nurturingLogger.error(
        { error, released, organizations: claimed.length },
        "a page of organization usage could not be sent; its claims are given back",
      );
      return failed + claimed.length;
    }
    return failed;
  }

  async #usageOf({
    organizationId,
    since,
  }: Readonly<{ organizationId: string; since: number }>): Promise<OrganizationUsage> {
    const { projects, prompts, evaluators, scenarios, traces } = this.dependencies;
    const projectIds = await projects.findProjectIds({ organizationId });
    const [promptCount, evaluatorCount, scenarioCount, traceUsage] = await Promise.all([
      prompts.countOrganizationVersionedPrompts({ organizationId }),
      evaluators.countActiveForProjects({ projectIds }),
      scenarios.countActiveForProjects({ projectIds }),
      traces.summarizeUsage({ projectIds, since }),
    ]);
    return {
      promptCount,
      evaluatorCount,
      scenarioCount,
      traceCount: traceUsage.traces,
      errorCount: traceUsage.errors,
      totalCost: traceUsage.totalCost,
      lastFailedTraceAt: traceUsage.lastFailedTraceAt,
    };
  }
}
