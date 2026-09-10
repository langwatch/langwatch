import type { CodingAgentSessionBranchRecord } from "@langwatch/coding-agent-contract";
import type { CodingAgentBillingPolicy } from "../app/coding-agent.members.ts";
import type { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository.ts";
import type { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository.ts";
import { CodingAgentPullRequestShareService } from "./coding-agent-pull-request-share.service.ts";
import type { CodingAgentPullRequestUsageService } from "./coding-agent-pull-request-usage.service.ts";

type CodingAgentSessionCandidatesDependencies = {
  sessions: CodingAgentSessionRepository;
  sessionEvents: CodingAgentSessionEventRepository;
  billing: CodingAgentBillingPolicy;
  usage: CodingAgentPullRequestUsageService;
};

/**
 * Which sessions a repository's branches may be attributed to, and which of their agents the
 * organization does not pay for. Both reads are shared by the project and personal pull-request
 * views, which would otherwise each grow their own copy.
 */
export class CodingAgentSessionCandidatesService {
  static create(
    options: CodingAgentSessionCandidatesDependencies,
  ): CodingAgentSessionCandidatesService {
    return new CodingAgentSessionCandidatesService(options);
  }

  private constructor(private readonly dependencies: CodingAgentSessionCandidatesDependencies) {}

  /**
   * Every session that may have worked on one repository's branches, found two ways and
   * merged: sessions whose own row matches (the legacy read), plus sessions whose STAMPED
   * fact rows name the repository even though their row has since moved to another one — a
   */
  async findCandidates({
    tenantIds,
    repositoryHost,
    repositoryOwner,
    repositoryName,
    branches,
    fromMs,
  }: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }): Promise<{
    sessions: CodingAgentSessionBranchRecord[];
    rowMatchedSessionKeys: ReadonlySet<string>;
  }> {
    // Independent reads, so they go together: the stamped one needs the
    // row-matched keys only to subtract them, which happens after both land.
    const [rowMatched, stamped] = await Promise.all([
      this.dependencies.sessions.listByRepositoryBranch({
        tenantIds,
        repositoryHost,
        repositoryOwner,
        repositoryName,
        branches,
        startedAtFromMs: fromMs,
      }),
      this.dependencies.sessionEvents.listSessionsByStampedBranch({
        tenantIds,
        repositoryHost,
        repositoryOwner,
        repositoryName,
        branches,
        fromMs,
      }),
    ]);
    const rowMatchedSessionKeys = new Set(
      rowMatched.map(CodingAgentPullRequestShareService.sessionKey),
    );

    const missing = stamped.filter(
      (pair) => !rowMatchedSessionKeys.has(CodingAgentPullRequestShareService.sessionKey(pair)),
    );
    if (missing.length === 0) {
      return { sessions: rowMatched, rowMatchedSessionKeys };
    }

    const fetched = await this.dependencies.sessions.listBySessionIds({
      tenantIds,
      sessionIds: [...new Set(missing.map((pair) => pair.sessionId))],
      startedAtFromMs: fromMs,
    });
    // The id read cannot scope per tenant, so a provider session id shared by
    // two projects fetches both; keep only the (tenant, session) pairs the
    // stamps actually named.
    const missingKeys = new Set(missing.map(CodingAgentPullRequestShareService.sessionKey));
    const stampedOnly = fetched.filter((session) =>
      missingKeys.has(CodingAgentPullRequestShareService.sessionKey(session)),
    );

    return {
      sessions: [...rowMatched, ...stampedOnly],
      rowMatchedSessionKeys,
    };
  }

  async nonBillableAgents(organizationId: string, agents: string[]): Promise<ReadonlySet<string>> {
    const distinct = [...new Set(agents.filter((agent) => agent !== ""))];
    const answers = await Promise.all(
      distinct.map(async (agent) => ({
        agent,
        nonBillable: await this.dependencies.billing.isSourceNonBillable({
          organizationId,
          sourceType: this.dependencies.usage.ingestSourceType(agent),
        }),
      })),
    );

    return new Set(answers.filter((answer) => answer.nonBillable).map((answer) => answer.agent));
  }
}
