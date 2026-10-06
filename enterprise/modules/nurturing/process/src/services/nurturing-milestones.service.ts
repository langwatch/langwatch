// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectCreatedEventData } from "@langwatch/project-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import {
  evaluationCompletedSignal,
  simulationRunFinishedSignal,
} from "../rules/nurturing-owner-signals.rules.ts";

/** How long a counted evaluation or run is remembered against a redelivered event. */
const COUNTED_WINDOW_SECONDS = 7 * 24 * 60 * 60;

type MilestonesDependencies = Readonly<{
  milestones: NurturingMilestonesRepository;
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
    return this.dependencies.milestones.recordProject({
      projectId: data.projectId,
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
    const organizations = await this.dependencies.milestones.countEvaluation({
      projectId: data.projectId,
    });
    return organizations.flatMap((organization) =>
      evaluationCompletedSignal({ data, aggregateId, organization }),
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
    const organizations = await this.dependencies.milestones.countSimulationRun({
      projectId: tenantId,
    });
    return organizations.flatMap((organization) =>
      simulationRunFinishedSignal({ data, aggregateId, tenantId, organization }),
    );
  }
}
