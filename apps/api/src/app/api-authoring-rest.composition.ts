/**
 * The four doors a person reaches while AUTHORING something, composed for this
 * process.
 *
 * The Studio's code completion and its run dispatch, the model playground, the
 * dataset editor's row generator and the scenario editor's author-assist are
 * four families in four feature packages, and they are composed together
 * because they share one fact: every one of them is
 * `handlerManagedAuth({ credential: "session" })`. They resolve the signed-in
 * person themselves and answer a bare `{ error }` at 401 and 403, which is the
 * wire the browser reads — so a process with no browser-session transport
 * mounts NONE of them rather than four doors that refuse everybody.
 *
 * Beyond the session each has its own second condition, and each is named
 * rather than filled with a stand-in:
 *
 *   code completion   a model. Absent gateway, absent door.
 *   post_event        the workflow application AND the studio dispatch.
 *   playground        the execution proxy's address. A playground with no
 *                     proxy to dial fails after the customer has already been
 *                     shown a streaming response, which is the one failure
 *                     they cannot tell from a bad answer.
 *   dataset generate  a model.
 *   scenario generate a model.
 *
 * The two Studio doors travel together because they are one Hono app on one
 * base path; a process holding a gateway but no workflow application would
 * publish half of it, so the family requires both.
 */
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { Logger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import type { WorkflowApp, WorkflowStudioDispatchService } from "@langwatch/workflow-server";

import type { ApiHandlerManagedSessionPort } from "./api-handler-managed-session";
import {
  apiExecutionProxyBaseUrl,
  composeApiAuthoringModelResolver,
  type ApiAuthoringModelResolver,
} from "./api-authoring-model.composition";
import type { ApiWorkflowStudioRestCollaborators } from "../features/workflow/workflow-studio-rest.mount";

/** The playground's collaborators, or none. */
export type ApiPlaygroundRestCollaborators = Readonly<{
  session: ApiHandlerManagedSessionPort;
  modelProviders: () => ModelProviderService;
  executionProxyBaseUrl: string;
}>;

/** One generator's collaborators, or none. */
export type ApiGeneratorRestCollaborators = Readonly<{
  session: ApiHandlerManagedSessionPort;
  resolveModel: ApiAuthoringModelResolver;
}>;

/** Which of the four authoring doors this process can actually open. */
export type ApiAuthoringRestComposition = Readonly<{
  workflowStudio?: ApiWorkflowStudioRestCollaborators | undefined;
  playground?: ApiPlaygroundRestCollaborators | undefined;
  datasetGenerate?: ApiGeneratorRestCollaborators | undefined;
  scenarioGenerate?: ApiGeneratorRestCollaborators | undefined;
}>;

/** What each absence costs, written where a deployment reads its logs. */
export abstract class ApiAuthoringRestAbsenceReport {
  abstract absent(
    door: "workflow-studio" | "playground" | "dataset-generate" | "scenario-generate",
    reason: string,
  ): void;
}

/** Composes the authoring doors from this process's graph. */
export function composeApiAuthoringRest(options: {
  /** The browser-session transport, where this process composed one. */
  session: ApiHandlerManagedSessionPort | undefined;
  /** The SAME gateway the execution half resolves a run's models through. */
  modelProviders: ModelProviderService | undefined;
  /** The project directory a model resolution names a tenant through. */
  projects: ProjectService | undefined;
  /** The workflow application the `workflow.*` namespace answers from. */
  workflows: WorkflowApp | undefined;
  /** The studio dispatch this process composed, opened per run. */
  studioDispatch: WorkflowStudioDispatchService | undefined;
  /** The NLP engine's address, or none where this deployment named one. */
  nlpServiceUrl: string | undefined;
  /** Where an unexpected authoring failure is reported. */
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
  report?: ApiAuthoringRestAbsenceReport | undefined;
}): ApiAuthoringRestComposition | undefined {
  const { session, modelProviders, projects, workflows, studioDispatch, nlpServiceUrl } = options;
  const report = options.report;
  if (!session) {
    for (const door of [
      "workflow-studio",
      "playground",
      "dataset-generate",
      "scenario-generate",
    ] as const) {
      report?.absent(door, "this process composed no browser-session transport");
    }
    return undefined;
  }

  const resolveModel = composeApiAuthoringModelResolver({
    modelProviders,
    projects,
    nlpServiceUrl,
  });
  const executionProxyBaseUrl = apiExecutionProxyBaseUrl(nlpServiceUrl);

  const composition: {
    workflowStudio?: ApiWorkflowStudioRestCollaborators;
    playground?: ApiPlaygroundRestCollaborators;
    datasetGenerate?: ApiGeneratorRestCollaborators;
    scenarioGenerate?: ApiGeneratorRestCollaborators;
  } = {};

  if (resolveModel && workflows && studioDispatch) {
    composition.workflowStudio = {
      session,
      resolveModel,
      workflows: () => workflows,
      postEvent: (input) => studioDispatch.postEvent(input),
      ...(options.reportError ? { reportError: options.reportError } : {}),
    };
  } else {
    report?.absent(
      "workflow-studio",
      !resolveModel
        ? "this process composed no model gateway"
        : !workflows
          ? "this process composed no workflow application"
          : "this process composed no studio dispatch",
    );
  }

  if (modelProviders && executionProxyBaseUrl) {
    composition.playground = {
      session,
      modelProviders: () => modelProviders,
      executionProxyBaseUrl,
    };
  } else {
    report?.absent(
      "playground",
      modelProviders
        ? "this deployment named no NLP engine to proxy through"
        : "this process composed no model gateway",
    );
  }

  if (resolveModel) {
    composition.datasetGenerate = { session, resolveModel };
    composition.scenarioGenerate = { session, resolveModel };
  } else {
    report?.absent("dataset-generate", "this process composed no model gateway");
    report?.absent("scenario-generate", "this process composed no model gateway");
  }

  return composition;
}

/** Writes each absent authoring door, and what it costs, to the process log. */
export class LoggedApiAuthoringRestAbsence extends ApiAuthoringRestAbsenceReport {
  static create(logger: Logger): LoggedApiAuthoringRestAbsence {
    return new LoggedApiAuthoringRestAbsence(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  absent(
    door: "workflow-studio" | "playground" | "dataset-generate" | "scenario-generate",
    reason: string,
  ): void {
    this.logger.warn({ door, reason }, `${reason}, so this process serves no ${DOOR_NAMES[door]}`);
  }
}

const DOOR_NAMES = {
  "workflow-studio": "Studio code completion or run dispatch",
  playground: "model playground",
  "dataset-generate": "dataset row generation",
  "scenario-generate": "scenario author-assist",
} as const;
