import { HttpError, type RestErrorHandler } from "@langwatch/api/rest";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ExperimentPublishedMonitor } from "@langwatch/experiment-contract";
import {
  ExperimentApp,
  type ExperimentAppDependencies,
  ExperimentFindOrCreateService,
  type ExecutionDataServices,
  type ExperimentRunAbortPort,
  type ExperimentRunPorts,
  type ExperimentRunProgressPort,
  type ExperimentService,
} from "@langwatch/experiment-server";
import { HandledError } from "@langwatch/handled-error";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowService } from "@langwatch/workflow-server";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { HandlerManagedCredential } from "../../../app/api-handler-managed-credential.ts";
import type { ApiExperimentRun } from "../../../app/api-experiment-run.composition.ts";
import { createApiRestRuntime, type ApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";

export const TEST_PROJECT = {
  id: "project-1",
  name: "Project One",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
} as const;

export const TEST_CREDENTIAL: ResolvedApiKeyCredential = {
  type: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "organization-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: TEST_PROJECT,
};

export const TEST_MONITOR: ExperimentPublishedMonitor = {
  id: "monitor-1",
  projectId: TEST_PROJECT.id,
  experimentId: "experiment-1",
  evaluatorId: null,
  checkType: "langevals/llm_boolean",
  name: "Support classifier",
  slug: "support-classifier",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: {},
  mappings: null,
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

export function successfulCredential(markUsed: () => void = () => {}): HandlerManagedCredential {
  return {
    ok: true,
    project: TEST_PROJECT,
    resolved: TEST_CREDENTIAL,
    markUsed,
  };
}

export function experimentApiRestRuntime(
  credential: HandlerManagedCredential = successfulCredential(),
): ApiRestRuntime {
  return createApiRestRuntime({
    projectCredential: async () => credential,
    organizationCredential: async () => {
      throw new Error("No organization route is mounted in this fixture");
    },
    organizationIdentity: async () => {
      throw new Error("No organization route is mounted in this fixture");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors: renderExperimentRestError,
  });
}

export function experimentApp(
  stubs: Partial<ExperimentService> = {},
): Readonly<{ app: ExperimentApp; experiments: ExperimentService }> {
  const experiments = createApiFixture<ExperimentService>(stubs);
  const infrastructure: ExperimentAppDependencies = {
    experiments,
    runLookup: ExperimentFindOrCreateService.create(experiments),
    workflows: createApiFixture<WorkflowService>(),
    workflowAuthoring: createApiFixture(),
    dataset: createApiFixture<DatasetApi>(),
    monitors: createApiFixture({
      deleteForExperiment: async () => {},
      upsertForExperiment: async () => TEST_MONITOR,
    }),
    broadcast: createApiFixture(),
    permissions: createApiFixture({ mayManageEvaluations: async () => true }),
    people: createApiFixture({ namesOf: async () => [] }),
    modelCosts: createApiFixture({ listFor: async () => [] }),
    slugify: (value) => value,
  };

  return {
    app: ExperimentApp.create({
      dependencies: {},
      infrastructure,
      config: undefined,
      resources: new ResourceScope(),
    }),
    experiments,
  };
}

export function experimentRun(
  options: {
    available?: boolean;
    findRunningProjectId?: (runId: string) => Promise<string | null>;
    requestAbort?: (runId: string) => Promise<void>;
  } = {},
): ApiExperimentRun {
  const available = options.available ?? true;
  const abort = createApiFixture<ExperimentRunAbortPort>({
    findRunningProjectId: options.findRunningProjectId ?? (async () => null),
    requestAbort: options.requestAbort ?? (async () => {}),
  });
  const ports = available ? createApiFixture<ExperimentRunPorts>({ abort }) : null;
  const progress = available
    ? createApiFixture<ExperimentRunProgressPort>({ findRunState: async () => null })
    : null;

  return createApiFixture<ApiExperimentRun>({
    ports,
    progress,
    services: createApiFixture<ExecutionDataServices>(),
    workflows: createApiFixture<WorkflowService>(),
    baseUrl: "https://app.langwatch.test",
    defaultConcurrency: 10,
    startRun: async () => ({ runId: "run-1", runUrl: "run-url", total: 0 }),
    evaluateWorkflow: async () => ({ status: "completed", result: {} }),
    resolveTargetNames: async () => ({}),
  });
}

export const renderExperimentRestError: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json(
      { error: error.code, ...(error.meta ?? {}) },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  if (error instanceof HttpError) {
    return context.json({ error: error.error, message: error.message }, error.status);
  }

  return context.json({ error: String(error) }, 500);
};
