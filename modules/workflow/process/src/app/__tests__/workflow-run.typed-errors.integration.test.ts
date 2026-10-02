import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
/**
 * @vitest-environment node
 * `POST /api/workflows/:workflowId/run` over the real app and the runtime a process mounts
 * it on: the run's typed refusals keep their statuses, and an untyped failure stays opaque.
 */
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { WorkflowRepositories } from "../../repositories/workflow-repositories.registry.ts";
import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import { workflowRunCallerKey, workflowRunRest } from "../../transport/workflow-run.rest.ts";
import { WorkflowModule } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

async function postRun({ repositories }: { repositories: WorkflowRepositories }) {
  const members = createWorkflowTestInfrastructure();
  const app = await WorkflowModule.create({
    members: {
      ...members,
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      nlpCodeBlockTimeoutSeconds: void 0,
      nlpServiceUrl: void 0,
      publicBaseUrl: void 0,
    },
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
    },
    config: {
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project_1" } as const }),
    },
  });

  return runtime
    .mount(workflowRunRest.router(), {
      app: () => app,
      credential: "project",
      onError: canonicalErrorResponse,
      facts: [bindRestMiddleware(workflowRunCallerKey, () => null)],
    })
    .request("/api/workflows/workflow_1/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "hello" }),
    });
}

describe("running a workflow over the public API", () => {
  /** @scenario "Running a nonexistent workflow returns 404" */
  it("answers 404 with workflow_not_found for a workflow that does not exist", async () => {
    const response = await postRun({ repositories: MemoryWorkflowRepositories.create() });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "workflow_not_found" });
  });

  /** @scenario "Running a workflow that has never been published returns 422" */
  it("answers 422 for a workflow that was never published", async () => {
    const repositories = MemoryWorkflowRepositories.create();
    await repositories.workflows.createWorkflow({
      id: "workflow_1",
      projectId: "project_1",
      name: "Triage",
      icon: null,
      description: null,
    });

    const response = await postRun({ repositories });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "validation_error" });
  });

  /** @scenario "An untyped runWorkflow error still returns a safe 500, not a leaked message" */
  it("answers 500 without the internal message for an untyped failure", async () => {
    const response = await postRun({
      repositories: {
        ...MemoryWorkflowRepositories.create(),
        workflows: createApiFixture<WorkflowRepository>(
          {
            findById: () => {
              throw new Error("connect ECONNREFUSED 10.0.0.7:5432");
            },
          },
          "WorkflowRepository",
        ),
      },
    });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("ECONNREFUSED");
  });
});
