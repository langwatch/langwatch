import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  PROJECT_API_KEY_SWEEP_INTERVAL_MS,
  PROJECT_API_KEY_SWEEP_PROCESS_NAME,
  type ProjectApiKeySweepDeps,
  type ProjectApiKeySweepState,
  projectApiKeySweepSchema,
  projectApiKeySweepWake,
  runProjectApiKeySweep,
} from "./process-manager/projectApiKeySweep.process";

export interface ProjectApiKeyMaintenancePipelineDeps {
  keySweep: ProjectApiKeySweepDeps;
}

/**
 * Moves project API keys stored in plaintext to hashed storage: hashes them,
 * then clears the plaintext once the grace window has passed. The hash needs
 * the API key pepper, which only the application holds, so a database
 * migration cannot do this.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createProjectApiKeyMaintenancePipeline(
  deps: ProjectApiKeyMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("project_api_key_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(PROJECT_API_KEY_SWEEP_PROCESS_NAME, (pm) =>
        pm
          .state<ProjectApiKeySweepState>({ lastSweepAt: null })
          .schedule({ everyMs: PROJECT_API_KEY_SWEEP_INTERVAL_MS })
          .onWake(projectApiKeySweepWake)
          .intent(
            "sweep",
            projectApiKeySweepSchema,
            runProjectApiKeySweep(deps.keySweep),
          )
          // Batched reads over every project still holding plaintext. That set
          // only shrinks, and is empty once the grace window has passed.
          .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
