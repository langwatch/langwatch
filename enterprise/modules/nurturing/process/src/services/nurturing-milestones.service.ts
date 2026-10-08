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

type MilestonesDependencies = Readonly<{
  milestones: NurturingMilestonesRepository;
  projects: NurturingProjectDirectoryRepository;
  claims: NurturingClaimRepository;
}>;

/**
 * Nurturing's own read model: which organization a project belongs to and its admin, from
 * project's created event, and each organization's evaluation count, from evaluation's (§9).
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
   * Counts a settled evaluation once and answers the signal it raises. The claim comes first, so a
   * redelivery never counts twice; a count that then fails is lost rather than doubled.
   */
  async evaluationCompleted({
    data,
    aggregateId,
  }: Readonly<{
    data: EvaluationLifecycleCompletedEventData;
    aggregateId: string;
  }>): Promise<NurturingSignal[]> {
    const key = `nurturing:evaluation-counted:${aggregateId}:${data.evaluationId}`;
    if (!(await this.dependencies.claims.claim(key, COUNTED_WINDOW_SECONDS))) return [];
    const organizations = await this.countFor({
      projectId: data.projectId,
      count: (input) => this.dependencies.milestones.countEvaluation(input),
    });
    return organizations.flatMap((organization) =>
      evaluationCompletedSignal({
        data,
        aggregateId,
        organization: { ...organization, seeded: seededAtRead(organization) },
      }),
    );
  }

  /** Counts a finished simulation run once, keyed by the run, and answers the signal it raises. */
  async simulationRunFinished({
    data,
    aggregateId,
    tenantId,
  }: Readonly<{
    data: SimulationRunFinishedEventData;
    aggregateId: string;
    tenantId: string;
  }>): Promise<NurturingSignal[]> {
    const key = `nurturing:simulation-counted:${aggregateId}`;
    if (!(await this.dependencies.claims.claim(key, COUNTED_WINDOW_SECONDS))) return [];
    const organizations = await this.countFor({
      projectId: tenantId,
      count: (input) => this.dependencies.milestones.countSimulationRun(input),
    });
    return organizations.flatMap((organization) =>
      simulationRunFinishedSignal({
        data,
        aggregateId,
        tenantId,
        organization: { ...organization, seeded: seededAtRead(organization) },
      }),
    );
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
