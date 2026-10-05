import type { AgentApi } from "@langwatch/agent-contract";
/**
 * @vitest-environment node
 * The engine a process names is the engine the studio and a workflow run reach: the address
 * composes the HTTP path, and no address at all refuses by name.
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretApi } from "@langwatch/secret-contract";
import { nlpInternalSecret, ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { WorkflowRepositories } from "../../repositories/workflow-repositories.registry.ts";
import { WorkflowModule } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

async function appAt({
  nlpServiceUrl,
  internalSecret,
  repositories = MemoryWorkflowRepositories.create(),
}: {
  nlpServiceUrl: string | undefined;
  internalSecret?: string;
  repositories?: WorkflowRepositories;
}): Promise<WorkflowModule> {
  const members = createWorkflowTestInfrastructure();

  return WorkflowModule.create({
    members: {
      ...members,
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
    },
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>(
        { getForProject: async () => ({}), getExecutionProviders: async () => ({}) },
        "ModelProviderApi",
      ),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({ mintRunKey: async () => "run-key" }, "ApiKeyApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>(
        { list: async () => [], getValuesByName: async () => ({}) },
        "SecretApi",
      ),
    },
    config: {
      nlpServiceUrl,
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
      relayTurnCeilingMs: void 0,
      publicBaseUrl: void 0,
      nlpCodeBlockTimeoutSeconds: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (handle, build) =>
      build(handle === nlpInternalSecret ? internalSecret : undefined),
    ),
    repositories,
  });
}

const aliveEvent = { type: "is_alive", payload: {} } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a process that names an engine address", () => {
  /** @scenario "An absent or unusable fleet configuration leaves the HTTP path" */
  it("streams the studio's events from that address", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('data: {"type":"is_alive_response","payload":{}}\n\n'),
    );
    vi.stubGlobal("fetch", fetchMock);

    await (
      await appAt({ nlpServiceUrl: "http://engine.test:5561/" })
    ).postStudioEvent({
      projectId: "project_1",
      event: aliveEvent,
      onEvent: () => void 0,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://engine.test:5561/go/studio/execute",
      expect.objectContaining({ method: "POST" }),
    );
  });

  /** @scenario "An absent or unusable fleet configuration leaves the HTTP path" */
  it("runs a published workflow on that address's synchronous route", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ status: "success" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const repositories = MemoryWorkflowRepositories.create();
    await repositories.workflows.createWorkflow({
      id: "workflow_1",
      projectId: "project_1",
      name: "Triage",
      icon: null,
      description: null,
    });
    await repositories.workflows.createVersion({
      id: "version_1",
      workflowId: "workflow_1",
      projectId: "project_1",
      parentId: null,
      version: "1",
      autoSaved: false,
      commitMessage: "first",
      dsl: parseStudioWorkflow({
        workflow_id: "workflow_1",
        spec_version: "1.5",
        name: "Triage",
        icon: "x",
        description: "x",
        version: "1",
        nodes: [],
        edges: [],
        state: {},
      }),
    });
    await repositories.workflows.publish({
      id: "workflow_1",
      projectId: "project_1",
      versionId: "version_1",
    });

    const answer = await (
      await appAt({
        nlpServiceUrl: "http://engine.test:5561",
        internalSecret: "engine-hop-secret",
        repositories,
      })
    ).runSynchronous({ workflowId: "workflow_1", projectId: "project_1", inputs: {} });

    expect(answer).toMatchObject({ status: "success" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://engine.test:5561/go/studio/execute_sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-LangWatch-NLP-Secret": "engine-hop-secret" }),
      }),
    );
  });
});

describe("a process that names no engine at all", () => {
  /** @scenario "A deployment with no engine at all refuses by name" */
  it("refuses a studio run by name instead of sending it nowhere", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      (await appAt({ nlpServiceUrl: void 0 })).postStudioEvent({
        projectId: "project_1",
        event: aliveEvent,
        onEvent: () => void 0,
      }),
    ).rejects.toThrow(/composed without an NLP engine address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("when a scenario asks whether a deployment without a fleet has per-project engines", () => {
  it("answers no for an engine address", async () => {
    expect((await appAt({ nlpServiceUrl: "http://nlp.test" })).hasPerProjectEngines()).toBe(false);
  });

  it("answers no with no engine at all", async () => {
    expect((await appAt({ nlpServiceUrl: void 0 })).hasPerProjectEngines()).toBe(false);
  });
});
