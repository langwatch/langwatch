/**
 * Everything a step of a run needs about the run it is a step of: the row that
 * says what to run, the identity it runs as, and what that identity may read.
 * A job has neither a session nor a credential, so both come from the project.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import { InstantEvalRunNotFoundError } from "@langwatch/instant-eval-contract";

import type {
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../repositories/instant-eval-run.repository.ts";
import { getInstantEvalQueryCapability } from "../rules/instant-eval-query-capability.rules.ts";
import {
  type InstantEvalRunQuestion,
  readInstantEvalRunQuestions,
} from "../rules/instant-eval-run-questions.rules.ts";

/** The peers a job resolves a project's own query identity through. */
export interface InstantEvalJobPeers {
  /** The project's restricted query identity, project-scoped and nothing more. */
  findProjectCaller(input: { projectId: string }): Promise<LangWatchQLCaller>;
  /** What the project itself may read, with nobody asking. */
  resolveProjectProtections(input: { projectId: string }): Promise<LangWatchQLProtections>;
  /** Whether this deployment provisioned a LangWatchQL identity at all. */
  isQueryIdentityAvailable(): boolean;
}

/** The run a step is a step of. */
export interface InstantEvalLoadedRun {
  readonly row: InstantEvalRunRow;
  readonly caller: LangWatchQLCaller;
  readonly protections: LangWatchQLProtections;
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly parameters: Readonly<Record<string, unknown>>;
}

export class InstantEvalRunContextService {
  private constructor(
    private readonly runs: Pick<InstantEvalRunRepository, "findById">,
    private readonly peers: InstantEvalJobPeers,
  ) {}

  static create({
    runs,
    peers,
  }: {
    runs: Pick<InstantEvalRunRepository, "findById">;
    peers: InstantEvalJobPeers;
  }): InstantEvalRunContextService {
    return new InstantEvalRunContextService(runs, peers);
  }

  /**
   * A run with no row, or a project with no query identity, is a run no step
   * can carry out — one refusal for both, because the step's caller can act on
   * neither and a job must not report a missing identity as a missing run.
   */
  async load({
    projectId,
    runId,
  }: {
    projectId: string;
    runId: string;
  }): Promise<InstantEvalLoadedRun> {
    const row = await this.runs.findById({ projectId, runId });
    if (!row) throw new InstantEvalRunNotFoundError({ runId });
    const project = await this.peers.findProjectCaller({ projectId });

    return {
      row,
      caller: getInstantEvalQueryCapability({
        project: { id: project.id, lwqlKey: project.lwqlKey || null },
        hasDeploymentIdentity: this.peers.isQueryIdentityAvailable(),
      }),
      protections: await this.peers.resolveProjectProtections({ projectId }),
      questions: readInstantEvalRunQuestions(row.questions),
      parameters: row.parameters,
    };
  }
}
