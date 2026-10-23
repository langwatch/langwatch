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

/** Sends one signal on; the batch's lane hands delivery in. */
type Deliver = (signal: NurturingSignal) => Promise<void>;

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

/**
 * The items whose key the claim repository had not seen inside the window, in order. A claim that
 * fails gives back every claim this call took, then throws, so the retry claims the batch whole.
 */
async function claimedOnly<Item>({
  items,
  keyOf,
  claims,
}: Readonly<{
  items: readonly Item[];
  keyOf: (item: Item) => string;
  claims: NurturingClaimRepository;
}>): Promise<Item[]> {
  const results = await Promise.allSettled(
    items.map(async (item) => ({
      item,
      taken: await claims.claim(keyOf(item), COUNTED_WINDOW_SECONDS),
    })),
  );
  const taken = results.flatMap((result) =>
    result.status === "fulfilled" && result.value.taken ? [result.value.item] : [],
  );
  const rejected = results.flatMap((result) => (result.status === "rejected" ? [result] : []));
  if (rejected.length === 0) return taken;
  const released = await releasedAll({ keys: taken.map(keyOf), claims });
  throw new AggregateError(
    [...rejected.map((result) => result.reason), ...released],
    "nurturing could not claim every item in the batch",
  );
}

/** Gives every claim back; the reasons a release failed, so the batch error carries them. */
async function releasedAll({
  keys,
  claims,
}: Readonly<{ keys: readonly string[]; claims: NurturingClaimRepository }>): Promise<unknown[]> {
  const results = await Promise.allSettled(keys.map((key) => claims.release(key)));
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
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
   * Counts a batch of settled evaluations, each once, and delivers one signal per project and
   * organization. Keyed by project and evaluation, as before batching, so a claim taken by an
   * earlier release still holds.
   */
  evaluationsCompleted({
    evaluations,
    deliver,
  }: Readonly<{
    evaluations: readonly EvaluationLifecycleCompletedEventData[];
    deliver: Deliver;
  }>): Promise<void> {
    return this.countByProject({
      items: evaluations,
      claimKeyOf: (data) => `nurturing:evaluation-counted:${data.projectId}:${data.evaluationId}`,
      projectOf: (data) => data.projectId,
      deliver,
      signalsFor: async (project) => {
        const latest = latestOf(project, (data) => data.occurredAt);
        const organizations = await this.countFor({
          projectId: latest.projectId,
          count: ({ organizationId }) =>
            this.dependencies.milestones.countEvaluation({ organizationId, by: project.length }),
        });
        return organizations.flatMap((organization) =>
          evaluationCompletedSignal({
            latest,
            count: project.length,
            organization: { ...organization, seeded: seededAtRead(organization) },
          }),
        );
      },
    });
  }

  /** Counts a batch of finished runs, each once by its run, and delivers one signal per project. */
  simulationRunsFinished({
    runs,
    deliver,
  }: Readonly<{ runs: readonly FinishedRun[]; deliver: Deliver }>): Promise<void> {
    return this.countByProject({
      items: runs,
      claimKeyOf: (run) => `nurturing:simulation-counted:${run.aggregateId}`,
      projectOf: (run) => run.tenantId,
      deliver,
      signalsFor: async (project) => {
        const latest = latestOf(project, (run) => run.data.occurredAt ?? 0);
        const organizations = await this.countFor({
          projectId: latest.tenantId,
          count: ({ organizationId }) =>
            this.dependencies.milestones.countSimulationRun({ organizationId, by: project.length }),
        });
        return organizations.flatMap((organization) =>
          simulationRunFinishedSignal({
            ...latest,
            count: project.length,
            organization: { ...organization, seeded: seededAtRead(organization) },
          }),
        );
      },
    });
  }

  /**
   * Claims each item, then counts and delivers project by project. A claim that fails gives back
   * every claim the batch took, so the retry starts whole. A project whose count fails gives its
   * claims back, so the queue's retry of the batch counts it; the projects already counted keep
   * theirs and are skipped. `signalsFor` must fail only before its count commits: after it,
   * signal building is pure. A delivery that fails keeps its project's claims, since the count
   * committed and counting again would double it, and the batch goes on to the next signal and
   * project. The batch throws once every project has been tried.
   */
  private async countByProject<Item>({
    items,
    claimKeyOf,
    projectOf,
    deliver,
    signalsFor,
  }: Readonly<{
    items: readonly Item[];
    claimKeyOf: (item: Item) => string;
    projectOf: (item: Item) => string;
    deliver: Deliver;
    signalsFor: (project: readonly Item[]) => Promise<NurturingSignal[]>;
  }>): Promise<void> {
    const claimed = await claimedOnly({
      items,
      keyOf: claimKeyOf,
      claims: this.dependencies.claims,
    });
    const countFailures: unknown[] = [];
    const deliveryFailures: unknown[] = [];
    for (const project of groupedBy(claimed, projectOf)) {
      let signals: NurturingSignal[];
      try {
        signals = await signalsFor(project);
      } catch (error) {
        const released = await releasedAll({
          keys: project.map(claimKeyOf),
          claims: this.dependencies.claims,
        });
        countFailures.push(error, ...released);
        continue;
      }
      for (const signal of signals) {
        try {
          await deliver(signal);
        } catch (error) {
          deliveryFailures.push(error);
        }
      }
    }
    const steps = [
      ...(countFailures.length > 0 ? ["count every project"] : []),
      ...(deliveryFailures.length > 0 ? ["deliver every signal"] : []),
    ];
    if (steps.length > 0) {
      throw new AggregateError(
        [...countFailures, ...deliveryFailures],
        `nurturing could not ${steps.join(" or ")} in the batch`,
      );
    }
  }

  /**
   * Empty when the owners hold no such project or nurturing never learned its organization. The
   * count is the last fallible step: a failure before it has written nothing, so the caller can
   * give its claims back without the retry counting twice.
   */
  private async countFor({
    projectId,
    count,
  }: Readonly<{
    projectId: string;
    count: (input: { organizationId: string }) => Promise<NurturingOrganizationCounts[]>;
  }>): Promise<NurturingOrganizationState[]> {
    const placement = await this.dependencies.projects.getPlacement({ projectId });
    if (placement.outcome === "unknown") return [];
    const { organizationId } = placement;
    const firstProject = await this.dependencies.projects.getFirstProjectCreatedAt({
      organizationId,
    });
    const counted = await count({ organizationId });
    return counted.map((organization) => ({ ...organization, ...firstProject }));
  }
}
