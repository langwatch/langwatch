import {
  ExperimentVersionNotFoundError,
  readSavedWorkbench,
  type SavedWorkbenchRead,
  type SaveWorkbenchStateBySlugRequest,
  type TargetConfig,
  type WorkbenchActor,
  type WorkbenchSavedVersion,
  type WorkbenchSaveResult,
  type WorkbenchStateAnswer,
  type WorkbenchStateBySlugRequest,
  type WorkbenchVersionsAnswer,
  type WorkbenchVersionsBySlugRequest,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

import { workbenchStateAnswer } from "../rules/experiment-workbench-state-answer.rules.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

type WorkbenchTargetNames = (input: {
  projectId: string;
  targets: TargetConfig[];
}) => Promise<Record<string, string>>;

/** A workbench's saved versions, addressed the way the `/api/experiments` doors name them. */
export class ExperimentWorkbenchVersionService {
  static create(options: {
    experiments: ExperimentService;
    workbenchTargetNames: WorkbenchTargetNames;
  }): ExperimentWorkbenchVersionService {
    return new ExperimentWorkbenchVersionService(options);
  }

  readonly #experiments: ExperimentService;
  readonly #workbenchTargetNames: WorkbenchTargetNames;

  private constructor(options: {
    experiments: ExperimentService;
    workbenchTargetNames: WorkbenchTargetNames;
  }) {
    this.#experiments = options.experiments;
    this.#workbenchTargetNames = options.workbenchTargetNames;
  }

  /** The saved board as an agent reads it, columns named as a run's own errors name them. */
  async projectSavedBySlug(input: {
    projectId: string;
    slug: string;
    includeResults?: boolean;
  }): Promise<SavedWorkbenchRead> {
    const { projectId, slug, includeResults } = input;
    const view = await this.#experiments.getWorkbenchState({ projectId, slug });
    if (!view.state) return readSavedWorkbench({ view });
    // A saved target may predate its declared fields; the resolver reads only its references.
    const targets = view.state.targets.map((target) => ({
      ...target,
      inputs: target.inputs ?? [],
      outputs: target.outputs ?? [],
    }));
    const targetNames = await this.#workbenchTargetNames({ projectId, targets });
    return readSavedWorkbench({ view, includeResults, targetNames });
  }

  async readStateBySlug(input: WorkbenchStateBySlugRequest): Promise<WorkbenchStateAnswer> {
    const { projectId, slug, fields } = input;
    const workbench = await this.#experiments.getWorkbenchState({ projectId, slug });

    return workbenchStateAnswer({ workbench, fields });
  }

  async saveBySlug(
    input: SaveWorkbenchStateBySlugRequest & Readonly<{ actor: WorkbenchActor }>,
  ): Promise<WorkbenchSavedVersion> {
    const { projectId, slug, state, expectedVersion, commitMessage, actor } = input;
    const saved = await this.#experiments.saveWorkbenchState({
      projectId,
      slug,
      state,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(commitMessage ? { commitMessage } : {}),
      actor,
    });

    return { version: saved.version };
  }

  async listBySlug(input: WorkbenchVersionsBySlugRequest): Promise<WorkbenchVersionsAnswer> {
    const { projectId, slug } = input;
    const workbench = await this.#experiments.getWorkbenchState({ projectId, slug });
    const { limit, cursor } = input;

    const { versions, nextCursor } = await this.#experiments.listWorkbenchVersions({
      projectId,
      id: workbench.experimentId,
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });

    return {
      versions: versions.map((version) => ({
        version: version.version,
        counterVersion: version.counterVersion,
        autoSaved: version.autoSaved,
        commitMessage: version.commitMessage,
        authorLabel: version.authorLabel,
        authorId: version.authorId,
        createdAt: version.createdAt.toISOString(),
        updatedAt: version.updatedAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async restoreBySlug(input: {
    projectId: string;
    slug: string;
    version: number;
    actor: WorkbenchActor;
  }): Promise<WorkbenchSaveResult> {
    const { projectId, slug, version, actor } = input;
    const workbench = await this.#experiments.getWorkbenchState({ projectId, slug });

    // A path segment that is not a version number arrives as 0, which no
    // experiment version ever is: the same answer as a number it never had.
    if (version === 0) {
      throw new ExperimentVersionNotFoundError({
        experimentId: workbench.experimentId,
        version: 0,
      });
    }

    const restored = await this.#experiments.restoreWorkbenchVersion({
      projectId,
      id: workbench.experimentId,
      version,
      actor,
    });

    logger.info({ projectId, slug, version }, "Experiment version restored over REST");

    return restored;
  }
}
