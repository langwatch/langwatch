// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

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
  utcDayOf,
} from "../rules/nurturing-coding-signals.rules.ts";
import { seededAtRead } from "../rules/nurturing-owner-signals.rules.ts";

type Deliver = (signal: NurturingSignal) => Promise<void>;
type Fact = CodingAgentSessionStoredEventData;

type CodingDependencies = Readonly<{
  milestones: NurturingCodingMilestonesRepository;
  projects: NurturingProjectDirectoryRepository;
}>;

/** The fact that happened last; the earliest in order wins a tie. */
function latestOf(facts: readonly Fact[]): Fact {
  return facts.reduce((latest, fact) => (fact.occurredAt > latest.occurredAt ? fact : latest));
}

/**
 * What nurturing decides from coding-agent's session-stored fact (§9), per project: the last
 * session, the first session of the organization, its agent types and its UTC active days. Each
 * step is one guarded write on the organization row, so a redelivery or a second pod changes
 * nothing and raises no second signal. Organizations nurturing never learned, and those with no
 * admin, raise nothing.
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
    const { organizationId, row } = organization;
    const common = { adminUserId, organizationId };

    await deliver(codingSessionStoredSignal({ data: latest, adminUserId }));

    // First session, then agent types, then the day: the order the signals are raised in.
    let agentTypes = row.codingAgentTypes;
    let sentFirst = false;
    const first = facts.find((fact) => fact.firstForProject);
    if (first && !organization.seeded) {
      const { first: isFirst } = await this.dependencies.milestones.recordCodingFirstSession({
        organizationId,
        occurredAt: first.occurredAt,
      });
      if (isFirst) {
        agentTypes = (await this.addAgentTypes({ organizationId, facts: [first] })).agentTypes;
        await deliver(codingAgentFirstSessionSignal({ data: first, agentTypes, ...common }));
        sentFirst = true;
      }
    }
    const added = await this.addAgentTypes({ organizationId, facts });
    if (added.changed && !sentFirst) {
      await deliver(
        codingAgentTypesSignal({ data: latest, agentTypes: added.agentTypes, ...common }),
      );
    }

    const day = utcDayOf(latest.occurredAt);
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

  /** Adds each distinct agent type once; `changed` when any was new, with the list as it stands. */
  private async addAgentTypes({
    organizationId,
    facts,
  }: Readonly<{ organizationId: string; facts: readonly Fact[] }>): Promise<{
    changed: boolean;
    agentTypes: string[];
  }> {
    let changed = false;
    let agentTypes: string[] = [];
    for (const agentType of new Set(facts.map((fact) => fact.agentType))) {
      const result = await this.dependencies.milestones.addCodingAgentType({
        organizationId,
        agentType,
      });
      changed ||= result.changed;
      agentTypes = result.codingAgentTypes;
    }
    return { changed, agentTypes };
  }

  /** Null when the owners hold no such project or nurturing never learned its organization. */
  private async organizationOf(
    projectId: string,
  ): Promise<{ organizationId: string; row: NurturingOrganizationRow; seeded: boolean } | null> {
    const placement = await this.dependencies.projects.getPlacement({ projectId });
    if (placement.outcome === "unknown") return null;
    const { organizationId } = placement;
    const [row] = await this.dependencies.milestones.findOrganization({ organizationId });
    if (!row) return null;
    const firstProject = await this.dependencies.projects.getFirstProjectCreatedAt({
      organizationId,
    });
    return { organizationId, row, seeded: seededAtRead({ ...row, ...firstProject }) };
  }
}

function groupedByProject(facts: readonly Fact[]): Fact[][] {
  const groups = new Map<string, Fact[]>();
  for (const fact of facts)
    groups.set(fact.projectId, [...(groups.get(fact.projectId) ?? []), fact]);
  return [...groups.values()];
}
