import {
  ExperimentVersionNotFoundError,
  type WorkbenchActor,
  type WorkbenchSaveResult,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

import { parseOptionalPositiveInt } from "../rules/experiment-version-number.rules.ts";
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
