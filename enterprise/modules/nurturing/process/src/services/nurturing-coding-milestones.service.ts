// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type {
  NurturingCodingMilestonesRepository,
  NurturingOrganizationRow,
} from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import {
  codingActiveDaysSignal,
  codingAgentFirstSessionSignal,
  codingAgentTypesSignal,
  codingSessionStoredSignal,
} from "../rules/nurturing-coding-signals.rules.ts";
import { seededAtRead } from "../rules/nurturing-owner-signals.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/** A client-supplied time is never trusted past tomorrow, so one far-future span cannot freeze the day count. */
const clampedToTomorrow = (epochMilliseconds: number): number =>
  Math.min(epochMilliseconds, nowInstant().epochMilliseconds + MAX_FUTURE_MS);

type Deliver = (signal: NurturingSignal) => Promise<void>;
type Fact = CodingAgentSessionStoredEventData;

type CodingDependencies = Readonly<{
  milestones: NurturingCodingMilestonesRepository;
  projects: NurturingProjectDirectoryRepository;
  /** The one nurturing -> organization edge: who to tell integration_method on a first session. */
  organizations: Pick<OrganizationApi, "getAllMembers">;
}>;

/** The fact that happened last; the earliest in order wins a tie. */
function latestOf(facts: readonly Fact[]): Fact {
  return facts.reduce((latest, fact) => (fact.occurredAt > latest.occurredAt ? fact : latest));
}

/**
 * What nurturing decides from coding-agent's session-stored fact (§9), per project: the last
 * session, first session, agent types and UTC active days. Each step is a guarded write that
 * answers a retry of the same fact again, and delivery's claims send each signal once.
 */
export class NurturingCodingMilestonesService {
  static create(dependencies: CodingDependencies): NurturingCodingMilestonesService {
    return new NurturingCodingMilestonesService(dependencies);
  }

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

    const day = utcDayOf(clampedToTomorrow(latest.occurredAt));
    const counted = await this.dependencies.milestones.recordCodingActiveDay({
      organizationId,
      day,
    });
    if (counted.changed) {
      await deliver(
        codingActiveDaysSignal({
          data: latest,
          day,
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
      occurredAt: clampedToTomorrow(first.occurredAt),
    });
    return isFirst;
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
      const result = await this.dependencies.milestones.addCodingAgentType({
        organizationId,
        agentType,
      });
      agentTypes = result.codingAgentTypes;
    }
    return agentTypes;
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
