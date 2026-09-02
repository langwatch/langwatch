/**
 * This process's composition of the packaged legacy evaluation REST family
 * (`@langwatch/evaluation-server`).
 *
 * Six routes moved with the family; TWO of them are mounted here, and the
 * other four name what they are missing rather than answering over it.
 *
 * **The evaluator catalogue serves.** `GET /api/evaluations/list` is the same
 * compiled-in list for every caller with no project data in it, so it needs
 * nothing this process might not have.
 *
 * **The batch result log serves where the run writer is composed.** It
 * resolves the experiment its rows belong to through the SAME
 * `ExperimentFindOrCreateService` `POST /api/experiment/init` resolves one
 * with — one construction on this process, handed to both — which is what
 * stops an SDK's `experiment_slug` naming one experiment on the door that
 * creates it and a second on the door it reports to. Its other two
 * collaborators travel with it because they are one write: the run history is
 * addressed by the experiment the first half resolved, so a process that could
 * resolve one but not record against it would answer 200 to rows nobody can
 * read back.
 *
 * **The four evaluate doors do not.** They need the evaluator RUNTIME — the
 * thing that calls langevals, a workflow or a model and returns a verdict —
 * and this process composes none: `runEvaluationForTrace` is already recorded
 * as absent on the execution half for the same reason. A door that
 * authenticates, validates and then fails at the last step is one an SDK
 * retries forever, so all four are left unregistered.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  createEvaluationsLegacyRestApp,
  type EvaluationBatchExperimentPort,
  type EvaluationsLegacyCredentialPort,
} from "@langwatch/evaluation-server";
import type { ExperimentFindOrCreateService } from "@langwatch/experiment-server";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features";

/** Everything `POST /api/evaluations/batch/log_results` binds to. */
export type ApiEvaluationBatchRestCollaborators = Readonly<{
  /** The ONE find-or-create rule this process resolves an SDK's slug through. */
  findOrCreate: ExperimentFindOrCreateService;
  /** The run history writer — the same one the workbench's own cells use. */
  experiments: () => EvaluationBatchExperimentPort;
  /** The verdict command; the same one the collector's evaluations travel on. */
  reportEvaluation: (input: Record<string, unknown>) => Promise<unknown>;
}>;

/** `/api/evaluations/list` and the batch log, plus the four absent doors. */
export function mountEvaluationsLegacyRest(options: {
  security: AppRestSecurity;
  credential: ApiHandlerManagedCredentialPort;
  batch?: ApiEvaluationBatchRestCollaborators | undefined;
}): MountableRestApp {
  // Every credentialed route on this family asks for `evaluations:manage` —
  // the over-coarse grain the family's own access declaration records rather
  // than quietly widens.
  const credential: EvaluationsLegacyCredentialPort = (input) =>
    options.credential({ request: input.request, permission: "evaluations:manage" });

  const batch = options.batch;

  return createEvaluationsLegacyRestApp({
    security: options.security,
    ports: {
      credential,
      ...(batch
        ? {
            batch: {
              findOrCreateExperiment: (input) =>
                batch.findOrCreate.resolve({
                  projectId: input.projectId,
                  experimentId: input.experimentId,
                  experimentSlug: input.experimentSlug,
                  experimentType: input.experimentType,
                  experimentName: input.experimentName,
                  workflowId: input.workflowId,
                }),
              experiments: batch.experiments,
              reportEvaluation: batch.reportEvaluation,
            },
          }
        : {}),
    },
  }).hono as unknown as MountableRestApp;
}
