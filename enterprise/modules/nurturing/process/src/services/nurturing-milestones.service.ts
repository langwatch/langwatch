// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectCreatedEventData } from "@langwatch/project-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type {
  NurturingMilestonesRepository,
  NurturingOrganizationCounts,
  NurturingOrganizationState,
} from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import {
  evaluationCompletedSignal,
  seededAtRead,
  simulationRunFinishedSignal,
} from "../rules/nurturing-owner-signals.rules.ts";

/** How long a counted evaluation or run is remembered against a redelivered event. */
const COUNTED_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** A finished run as its peer lane hands it over: the run's data, its aggregate and tenant. */
type FinishedRun = Readonly<{
  data: SimulationRunFinishedEventData;
  aggregateId: string;
  tenantId: string;
}>;

type MilestonesDependencies = Readonly<{
  milestones: NurturingMilestonesRepository;
  projects: NurturingProjectDirectoryRepository;
  claims: NurturingClaimRepository;
}>;

/** The items whose key the claim repository had not seen inside the window, in order. */
async function claimedOnly<Item>({
  items,
  keyOf,
  claims,
}: Readonly<{
  items: readonly Item[];
  keyOf: (item: Item) => string;
  claims: NurturingClaimRepository;
}>): Promise<Item[]> {
  const claimed = await Promise.all(
    items.map((item) => claims.claim(keyOf(item), COUNTED_WINDOW_SECONDS)),
  );
  return items.filter((_, index) => claimed[index]);
}

/** Items grouped by a key, the groups in order of their first item. */
function groupedBy<Item>(items: readonly Item[], keyOf: (item: Item) => string): Item[][] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

/** The item that happened last; the earliest in order wins a tie. */
function latestOf<Item>(items: readonly Item[], instantOf: (item: Item) => number): Item {
  return items.reduce((latest, item) => (instantOf(item) > instantOf(latest) ? item : latest));
}

/**
 * Nurturing's own read model: which organization a project belongs to and its admin, from
 * project's created event, and each organization's evaluation and run counts, from evaluation's
 * and scenario's (§9). Counts come in batches: a backed-up project's settled evaluations or
 * finished runs are counted in one step and raise one signal, however many the batch holds.
 */
export class NurturingMilestonesService {
  static create(dependencies: MilestonesDependencies): NurturingMilestonesService {
    return new NurturingMilestonesService(dependencies);
  }

  private constructor(private readonly dependencies: MilestonesDependencies) {}

  /** A backfilled project seeds its organization: its first_* milestones already happened. */
  projectCreated(data: ProjectCreatedEventData): Promise<void> {
    return this.dependencies.milestones.recordOrganization({
      organizationId: data.organizationId,
      adminUserId: data.adminUserId ?? null,
      seeded: data.backfilled === true,
    });
  }

  /**
   * Counts a batch of settled evaluations, each once, and answers one signal per project. Every
   * claim comes first, so a redelivered evaluation never counts twice; a count that then fails is
   * lost rather than doubled. Keyed by project and evaluation, as before batching, so a claim
   * taken by an earlier release still holds.
   */
  async evaluationsCompleted(
    evaluations: readonly EvaluationLifecycleCompletedEventData[],
  ): Promise<NurturingSignal[]> {
    const counted = await claimedOnly({
      items: evaluations,
      keyOf: (data) => `nurturing:evaluation-counted:${data.projectId}:${data.evaluationId}`,
      claims: this.dependencies.claims,
    });
    const signals: NurturingSignal[] = [];
    for (const project of groupedBy(counted, (data) => data.projectId)) {
      const latest = latestOf(project, (data) => data.occurredAt);
      const organizations = await this.countFor({
        projectId: latest.projectId,
        count: ({ organizationId }) =>
          this.dependencies.milestones.countEvaluation({ organizationId, by: project.length }),
      });
      for (const organization of organizations) {
        signals.push(
          ...evaluationCompletedSignal({
            latest,
            count: project.length,
            organization: { ...organization, seeded: seededAtRead(organization) },
          }),
        );
      }
    }
    return signals;
  }

  /** Counts a batch of finished runs, each once by its run, and answers one signal per project. */
  async simulationRunsFinished(runs: readonly FinishedRun[]): Promise<NurturingSignal[]> {
    const counted = await claimedOnly({
      items: runs,
      keyOf: (run) => `nurturing:simulation-counted:${run.aggregateId}`,
      claims: this.dependencies.claims,
    });
    const signals: NurturingSignal[] = [];
    for (const project of groupedBy(counted, (run) => run.tenantId)) {
      const latest = latestOf(project, (run) => run.data.occurredAt ?? 0);
      const organizations = await this.countFor({
        projectId: latest.tenantId,
        count: ({ organizationId }) =>
          this.dependencies.milestones.countSimulationRun({ organizationId, by: project.length }),
      });
      for (const organization of organizations) {
        signals.push(
          ...simulationRunFinishedSignal({
            ...latest,
            counted: project.length,
            organization: { ...organization, seeded: seededAtRead(organization) },
          }),
        );
      }
    }
    return signals;
  }

  /** Empty when the owners hold no such project or nurturing never learned its organization. */
  private async countFor({
    projectId,
    count,
  }: Readonly<{
    projectId: string;
    count: (input: { organizationId: string }) => Promise<NurturingOrganizationCounts[]>;
  }>): Promise<NurturingOrganizationState[]> {
    const placement = await this.dependencies.projects.getPlacement({ projectId });
    if (placement.outcome === "unknown") return [];
    const counted = await count({ organizationId: placement.organizationId });
    return Promise.all(
      counted.map(async (organization) => ({
        ...organization,
        ...(await this.dependencies.projects.getFirstProjectCreatedAt({
          organizationId: organization.organizationId,
        })),
      })),
    );
  }
}
