/**
 * @vitest-environment node
 * User code runs inside each project's own function and can read its invokes, so the engine
 * hop's shared secret never rides the Lambda path: only the single shared service checks it.
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { NLP_INTERNAL_SECRET_HEADER } from "@langwatch/process/nlp-internal-secret";
import type { SecretApi } from "@langwatch/secret-contract";
import { nlpInternalSecret, ScopedSecrets, type SecretHandle } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { parseStudioWorkflow, type WorkflowServerConfig } from "@langwatch/workflow-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpWorkflowChannels } from "../../channels/http/http.workflow.channels.ts";
import { nlpLambdaFleetSecret } from "../../channels/workflow.channels.ts";
import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { WorkflowRepositories } from "../../repositories/workflow-repositories.registry.ts";
import { NLP_LAMBDA_ARN_CACHE_PREFIX } from "../../services/nlp-lambda-runtime.service.ts";
import { WorkflowModule } from "../workflow.app.ts";

const SHARED_SECRET = "engine-hop-secret";
const PROJECT_ID = "project_1";
const FUNCTION_ARN = "arn:aws:lambda:eu-west-1:1:function:langwatch_nlp-project_1";

/** Every Lambda invoke the composed clients were asked to send, as AWS would receive it. */
const aws = vi.hoisted(() => {
  const invokes: { command: string; payload: string }[] = [];
  const encode = (text: string) => new TextEncoder().encode(text);
  /** A Lambda Web Adapter answer: the prelude, eight NULs, then the engine's body. */
  const framed = (body: string) => {
    const prelude = encode(JSON.stringify({ statusCode: 200, headers: {}, cookies: [] }));
    const out = new Uint8Array(prelude.length + 8 + encode(body).length);
    out.set(prelude, 0);
    out.set(encode(body), prelude.length + 8);
    return out;
  };

  class RecordingLambdaClient {
    send(command: { constructor: { name: string }; input: { Payload?: unknown } }) {
      invokes.push({ command: command.constructor.name, payload: String(command.input.Payload) });
      if (command.constructor.name === "InvokeWithResponseStreamCommand") {
        return Promise.resolve({
          EventStream: (async function* () {
            yield { PayloadChunk: { Payload: framed('data: {"type":"is_alive_response"}\n\n') } };
            yield { InvokeComplete: {} };
          })(),
        });
      }
      return Promise.resolve({
        StatusCode: 200,
        Payload: framed(JSON.stringify({ status: "success" })),
      });
    }

    destroy(): void {}
  }

  return { invokes, RecordingLambdaClient };
});

vi.mock("@aws-sdk/client-lambda", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LambdaClient: aws.RecordingLambdaClient,
}));
vi.mock("@aws-sdk/client-cloudwatch-logs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CloudWatchLogsClient: class {
    destroy(): void {}
  },
}));

const config: WorkflowServerConfig = {
  nlpServiceUrl: void 0,
  stagingThresholdBytes: void 0,
  stagingTtlSeconds: 600,
  relayTurnCeilingMs: void 0,
  publicBaseUrl: "https://app.test",
  nlpCodeBlockTimeoutSeconds: void 0,
};

const fleet = {
  AWS_REGION: "eu-west-1",
  role_arn: "arn:aws:iam::1:role/nlp-execution",
  image_uri: "1.dkr.ecr.eu-west-1.amazonaws.com/nlp:1",
  cache_bucket: "studio-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
  AWS_ACCESS_KEY_ID: "AKIA_TEST",
  AWS_SECRET_ACCESS_KEY: "test-secret",
};

/** A process naming a fleet AND holding the shared secret, with the project's function cached. */
async function lambdaApp() {
  const asked: SecretHandle<unknown>[] = [];
  const secrets = new ScopedSecrets(async (handle, build) => {
    asked.push(handle);
    if (handle === nlpLambdaFleetSecret) return build(JSON.stringify(fleet));
    return build(handle === nlpInternalSecret ? SHARED_SECRET : undefined);
  });
  const channels = await HttpWorkflowChannels.create({
    config,
    secrets,
    bound: { spend: createApiFixture<GatewayApi>() },
  });
  if (channels.engine.kind !== "lambda") throw new Error("expected the Lambda engine");
  const repositories = MemoryWorkflowRepositories.create();
  await repositories.nlpLambdaArns.set({
    key: `${NLP_LAMBDA_ARN_CACHE_PREFIX}${PROJECT_ID}`,
    value: JSON.stringify({
      arn: FUNCTION_ARN,
      imageUri: channels.engine.imageUri,
      configFingerprint: channels.engine.configFingerprint,
    }),
    ttlSeconds: 600,
  });
  const app = await WorkflowModule.create({
    dependencies: {
      modelProviders: createApiFixture<ModelProviderApi>(
        { getForProject: async () => ({}), getExecutionProviders: async () => ({}) },
        "ModelProviderApi",
      ),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({ mintRunKey: async () => "run-key" }, "ApiKeyApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      secrets: createApiFixture<SecretApi>(
        { list: async () => [], getValuesByName: async () => ({}) },
        "SecretApi",
      ),
    },
    config,
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets,
    channels,
    repositories,
  });

  return { app, repositories, asked, engine: channels.engine };
}

async function publishWorkflow(repositories: WorkflowRepositories): Promise<void> {
  await repositories.workflows.createWorkflow({
    id: "workflow_1",
    projectId: PROJECT_ID,
    name: "Triage",
    icon: null,
    description: null,
  });
  await repositories.workflows.createVersion({
    id: "version_1",
    workflowId: "workflow_1",
    projectId: PROJECT_ID,
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
    projectId: PROJECT_ID,
    versionId: "version_1",
  });
}

/** The headers of each invoke envelope, and the envelope itself, as the function reads them. */
function sentToFunction(): { headers: Record<string, string>; raw: string }[] {
  return aws.invokes.map(({ payload }) => ({
    headers: (JSON.parse(payload) as { headers: Record<string, string> }).headers,
    raw: payload,
  }));
}

beforeEach(() => {
  aws.invokes.length = 0;
});

describe("given a process that names a Lambda fleet and holds the engine hop's shared secret", () => {
  describe("when a published workflow runs on the project's own function", () => {
    it("invokes the function without the shared secret anywhere in the envelope", async () => {
      const { app, repositories } = await lambdaApp();
      await publishWorkflow(repositories);

      const answer = await app.runSynchronous({
        workflowId: "workflow_1",
        projectId: PROJECT_ID,
        inputs: {},
      });

      expect(answer).toMatchObject({ status: "success" });
      const sent = sentToFunction();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.headers).not.toHaveProperty(NLP_INTERNAL_SECRET_HEADER);
      expect(sent[0]?.raw).not.toContain(SHARED_SECRET);
    });
  });

  describe("when the studio streams from the project's own function", () => {
    it("invokes the function without the shared secret anywhere in the envelope", async () => {
      const { app } = await lambdaApp();

      await app.postStudioEvent({
        projectId: PROJECT_ID,
        event: { type: "is_alive", payload: {} },
        onEvent: () => void 0,
      });

      const sent = sentToFunction();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.headers).not.toHaveProperty(NLP_INTERNAL_SECRET_HEADER);
      expect(sent[0]?.raw).not.toContain(SHARED_SECRET);
    });
  });

  describe("when the engine is composed", () => {
    it("never reads the shared secret, so the Lambda engine cannot carry it", async () => {
      const { asked, engine } = await lambdaApp();

      expect(asked).not.toContain(nlpInternalSecret);
      expect(Object.values(engine)).not.toContain(SHARED_SECRET);
    });
  });
});
