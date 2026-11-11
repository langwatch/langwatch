// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type {
  NurturingCodingMilestonesRepository,
  NurturingOrganizationRow,
} from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import {
  codingActiveDaysSignal,
  codingAgentFirstSessionSignal,
  codingAgentTypesSignal,
  codingRepoCountSignal,
  codingSessionDayOffsets,
  codingSessionDaysFirst3Signal,
  codingSessionStoredSignal,
  codingTerminalTypesSignal,
  ownCodingSessionRecipients,
  ownCodingSessionStoredSignal,
} from "../rules/nurturing-coding-signals.rules.ts";
import { seededAtRead } from "../rules/nurturing-owner-signals.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";

type Deliver = (signal: NurturingSignal) => Promise<void>;
type Fact = CodingAgentSessionStoredEventData;

type CodingDependencies = Readonly<{
  milestones: NurturingCodingMilestonesRepository;
  projects: NurturingProjectDirectoryRepository;
  /** The one nurturing -> organization edge: who to tell uses_coding_agent on a first session. */
  organizations: Pick<OrganizationApi, "getAllMembers">;
  clock: Readonly<{ nowMs(): number }>;
}>;

/** How many creation times one service holds; at it, it starts over rather than track idleness. */
const MAX_REMEMBERED_CREATIONS = 10_000;

/** The fact that happened last; the earliest in order wins a tie. */
function latestOf(facts: readonly Fact[]): Fact {
  return facts.reduce((latest, fact) => (fact.occurredAt > latest.occurredAt ? fact : latest));
}

function earliestOf(facts: readonly Fact[]): Fact {
  return facts.reduce((earliest, fact) =>
    fact.occurredAt < earliest.occurredAt ? fact : earliest,
  );
}

/**
 * What nurturing decides from coding-agent's session-stored fact (§9), per project: the last
 * session, first session, agent types, terminal types, repo count, first-three-days count and UTC
 * active days. Each step is a guarded write that answers a retry again; claims send each once.
 */
export class NurturingCodingMilestonesService {
  static create(dependencies: CodingDependencies): NurturingCodingMilestonesService {
    return new NurturingCodingMilestonesService(dependencies);
  }

  /** An organization's creation never moves, and every session batch of it needs the time. */
  private readonly creations = new Map<string, number>();

  private constructor(private readonly dependencies: CodingDependencies) {}

  async sessionsStored({
    sessions,
    deliver,
  }: Readonly<{ sessions: readonly Fact[]; deliver: Deliver }>): Promise<void> {
    for (const project of groupedByProject(sessions)) {
      await this.projectSessionsStored({ facts: project, deliver });
    }
  }

  private async projectSessionsStored({
    facts,
    deliver,
  }: Readonly<{ facts: readonly Fact[]; deliver: Deliver }>): Promise<void> {
    const latest = latestOf(facts);
    const organization = await this.organizationOf(latest.projectId);
    const adminUserId = organization?.row.adminUserId;
    if (!organization || !adminUserId) return;
    const { organizationId } = organization;
    const common = { adminUserId, organizationId };

    await deliver(codingSessionStoredSignal({ data: latest, adminUserId }));
    await this.deliverOwnSessions({ facts, latest, organizationId, deliver });

    // Every type first, so the first-session signal names them all; then first session, then day.
    const agentTypes = await this.addAgentTypes({ organizationId, facts });
    const first = facts.find((fact) => fact.firstForProject);
    if (first && (await this.isFirstSession({ organization, first }))) {
      const memberUserIds = await this.memberUserIdsOf(organizationId);
      await deliver(
        codingAgentFirstSessionSignal({ data: first, agentTypes, memberUserIds, ...common }),
      );
    } else {
      await deliver(codingAgentTypesSignal({ data: latest, agentTypes, ...common }));
    }

    const terminalTypes = await this.addTerminalTypes({ organizationId, facts });
    if (terminalTypes.length > 0) {
      await deliver(codingTerminalTypesSignal({ data: latest, terminalTypes, ...common }));
    }
    const codingRepoCount = await this.addRepositories({ organizationId, facts });
    if (codingRepoCount > 0) {
      await deliver(codingRepoCountSignal({ data: latest, codingRepoCount, ...common }));
    }

    const codingSessionDaysFirst3 = await this.addFirstDays({ organizationId, facts });
    if (codingSessionDaysFirst3 > 0) {
      await deliver(
        codingSessionDaysFirst3Signal({ data: latest, codingSessionDaysFirst3, ...common }),
      );
    }

    // Each UTC day of the batch counts, oldest first: a batch over midnight loses none.
    const days = [...new Set(facts.map((fact) => utcDayOf(fact.occurredAt)))].toSorted();
    let counted: { day: string; codingActiveDays: number } | null = null;
    for (const day of days) {
      const result = await this.dependencies.milestones.recordCodingActiveDay({
        organizationId,
        day,
      });
      if (result.changed) counted = { day, codingActiveDays: result.codingActiveDays };
    }
    if (counted) {
      await deliver(
        codingActiveDaysSignal({
          data: latest,
          day: counted.day,
          codingActiveDays: counted.codingActiveDays,
          ...common,
        }),
      );
    }
  }

  /** Reads the owners' first project only here: a seeded organization never had a first session. */
  private async isFirstSession({
    organization: { organizationId, row },
    first,
  }: Readonly<{
    organization: { organizationId: string; row: NurturingOrganizationRow };
    first: Fact;
  }>): Promise<boolean> {
    const firstProject = await this.dependencies.projects.getFirstProjectCreatedAt({
      organizationId,
    });
    if (seededAtRead({ ...row, ...firstProject })) return false;
    const { first: isFirst } = await this.dependencies.milestones.recordCodingFirstSession({
      organizationId,
      occurredAt: first.occurredAt,
    });
    return isFirst;
  }

  /** The batch as the personal project owner's own sessions; a shared project reads no members. */
  private async deliverOwnSessions({
    facts,
    latest,
    organizationId,
    deliver,
  }: Readonly<{
    facts: readonly Fact[];
    latest: Fact;
    organizationId: string;
    deliver: Deliver;
  }>): Promise<void> {
    const personalOwnerUserIds = await this.dependencies.projects.findPersonalOwnerUserIds({
      projectId: latest.projectId,
    });
    if (personalOwnerUserIds.length === 0) return;
    const activeMemberUserIds = await this.memberUserIdsOf(organizationId);
    const earliest = earliestOf(facts);
    for (const userId of ownCodingSessionRecipients({
      personalOwnerUserIds,
      activeMemberUserIds,
    })) {
      await deliver(ownCodingSessionStoredSignal({ latest, earliest, userId }));
    }
  }

  private async memberUserIdsOf(organizationId: string): Promise<string[]> {
    const users = await this.dependencies.organizations.getAllMembers({ organizationId });
    return users.map(({ id }) => id);
  }

  /** Adds each distinct agent type once; returns the list as it stands. */
  private async addAgentTypes({
    organizationId,
    facts,
  }: Readonly<{ organizationId: string; facts: readonly Fact[] }>): Promise<string[]> {
    let agentTypes: string[] = [];
    for (const agentType of new Set(facts.map((fact) => fact.agentType))) {
      agentTypes = await this.dependencies.milestones.addCodingAgentType({
        organizationId,
        agentType,
      });
    }
    return agentTypes;
  }

  /** Adds each distinct terminal type once; empty when no fact of the batch names one. */
  private async addTerminalTypes({
    organizationId,
    facts,
  }: Readonly<{ organizationId: string; facts: readonly Fact[] }>): Promise<string[]> {
    let terminalTypes: string[] = [];
    for (const terminalType of new Set(facts.flatMap((fact) => fact.terminalType ?? []))) {
      terminalTypes = await this.dependencies.milestones.addCodingTerminalType({
        organizationId,
        terminalType,
      });
    }
    return terminalTypes;
  }

  /** Adds each distinct repo once; zero when no fact of the batch names one. */
  private async addRepositories({
    organizationId,
    facts,
  }: Readonly<{ organizationId: string; facts: readonly Fact[] }>): Promise<number> {
    let count = 0;
    for (const repositoryKey of new Set(facts.flatMap((fact) => fact.repositoryKey ?? []))) {
      count = await this.dependencies.milestones.addCodingRepository({
        organizationId,
        repositoryKey,
      });
    }
    return count;
  }

  /** Adds each of the batch's first-three-days offsets once; zero when it has none. */
  private async addFirstDays({
    organizationId,
    facts,
  }: Readonly<{ organizationId: string; facts: readonly Fact[] }>): Promise<number> {
    const organizationCreatedAt = await this.creationOf(organizationId);
    if (organizationCreatedAt === null) return 0;
    let count = 0;
    const offsets = codingSessionDayOffsets({
      organizationCreatedAt,
      occurredAts: facts.map((fact) => fact.occurredAt),
      now: this.dependencies.clock.nowMs(),
    });
    for (const dayOffset of offsets) {
      count = await this.dependencies.milestones.addCodingSessionDayOffset({
        organizationId,
        dayOffset,
      });
    }
    return count;
  }

  /** Null, and asked again next time, when the owners hold no creation time for it. */
  private async creationOf(organizationId: string): Promise<number | null> {
    const known = this.creations.get(organizationId);
    if (known !== undefined) return known;
    const { organizationCreatedAt } = await this.dependencies.projects.getOrganizationCreatedAt({
      organizationId,
    });
    if (organizationCreatedAt === null) return null;
    if (this.creations.size >= MAX_REMEMBERED_CREATIONS) this.creations.clear();
    this.creations.set(organizationId, organizationCreatedAt);
    return organizationCreatedAt;
  }

  /** Null when the owners hold no such project or nurturing never learned its organization. */
  private async organizationOf(
    projectId: string,
  ): Promise<{ organizationId: string; row: NurturingOrganizationRow } | null> {
    const placement = await this.dependencies.projects.getPlacement({ projectId });
    if (placement.outcome === "unknown") return null;
    const { organizationId } = placement;
    const [row] = await this.dependencies.milestones.findOrganization({ organizationId });
    return row ? { organizationId, row } : null;
  }
}

function groupedByProject(facts: readonly Fact[]): Fact[][] {
  const groups = new Map<string, Fact[]>();
  for (const fact of facts) {
    const group = groups.get(fact.projectId);
    if (group) group.push(fact);
    else groups.set(fact.projectId, [fact]);
  }
  return [...groups.values()];
}
