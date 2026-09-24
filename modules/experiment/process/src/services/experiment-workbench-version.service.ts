import {
  ExperimentVersionNotFoundError,
  type SaveWorkbenchStateBySlugRequest,
  type WorkbenchActor,
  type WorkbenchSavedVersion,
  type WorkbenchSaveResult,
  type WorkbenchStateAnswer,
  type WorkbenchStateBySlugRequest,
  type WorkbenchVersionsAnswer,
  type WorkbenchVersionsBySlugRequest,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

import { parseOptionalPositiveInt } from "../rules/experiment-version-number.rules.ts";
import { workbenchStateAnswer } from "../rules/experiment-workbench-state-answer.rules.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

/** A workbench's saved versions, addressed the way the `/api/experiments` doors name them. */
export class ExperimentWorkbenchVersionService {
  static create(options: { experiments: ExperimentService }): ExperimentWorkbenchVersionService {
    return new ExperimentWorkbenchVersionService(options);
  }

  readonly #experiments: ExperimentService;

  private constructor(options: { experiments: ExperimentService }) {
    this.#experiments = options.experiments;
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
    const limit = parseOptionalPositiveInt(input.limit);
    const cursor = parseOptionalPositiveInt(input.cursor);

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
    version: string;
    actor: WorkbenchActor;
  }): Promise<WorkbenchSaveResult> {
    const { projectId, slug, version, actor } = input;
    const workbench = await this.#experiments.getWorkbenchState({ projectId, slug });

    // A path segment that is not a version number names a version this
    // experiment never had, which is the same answer as a number it never
    // had. `version: 0` because no experiment version is ever 0.
    const parsedVersion = parseOptionalPositiveInt(version);
    if (parsedVersion === undefined) {
      throw new ExperimentVersionNotFoundError({
        experimentId: workbench.experimentId,
        version: 0,
      });
    }

    const restored = await this.#experiments.restoreWorkbenchVersion({
      projectId,
      id: workbench.experimentId,
      version: parsedVersion,
      actor,
    });

    logger.info(
      { projectId, slug, version: parsedVersion },
      "Experiment version restored over REST",
    );

    return restored;
  }
}
