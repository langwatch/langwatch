import { InvokeWithResponseStreamCommand } from "@aws-sdk/client-lambda";
import type { AgentApi } from "@langwatch/agent-contract";
/**
 * @vitest-environment node
 * A deployment that names its per-project fleet runs the studio on each project's own function,
 * and one that names a fleet it cannot use refuses rather than falling back to the address.
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { StudioServerEvent } from "@langwatch/workflow-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { WorkflowRepositories } from "../../repositories/workflow-repositories.registry.ts";
import {
  buildStudioLambdaConfig,
  studioLambdaConfigFingerprint,
} from "../../rules/nlp-lambda-config.rules.ts";
import { NLP_LAMBDA_ARN_CACHE_PREFIX } from "../../services/nlp-lambda-runtime.service.ts";
import { WorkflowModule } from "../workflow.app.ts";

const lambda = vi.hoisted(() => {
  const sent: unknown[] = [];
  const encoder = new TextEncoder();

  /** One studio answer as the Lambda Web Adapter streams it: prelude, eight NULs, SSE. */
  async function* studioFrames(): AsyncGenerator<unknown> {
    const prelude = encoder.encode(JSON.stringify({ statusCode: 200 }));
    const body = encoder.encode('data: {"type":"is_alive_response","payload":{}}\n\n');
    const chunk = new Uint8Array(prelude.length + 8 + body.length);
    chunk.set(prelude, 0);
    chunk.set(body, prelude.length + 8);
    yield { PayloadChunk: { Payload: chunk } };
    yield { InvokeComplete: {} };
  }

  /** Records every command and answers a streaming invoke with one studio event. */
  class RecordingLambdaClient {
    send(command: unknown): Promise<unknown> {
      sent.push(command);

      return Promise.resolve({ EventStream: studioFrames() });
    }

    destroy(): void {}
  }

  return { sent, RecordingLambdaClient };
});

vi.mock("@aws-sdk/client-lambda", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LambdaClient: lambda.RecordingLambdaClient,
}));

const FUNCTION_ARN = "arn:aws:lambda:eu-west-1:123456789012:function:langwatch_nlp-project_1";

const fleet = {
  AWS_REGION: "eu-west-1",
  AWS_ACCESS_KEY_ID: "AKIA_TEST",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  role_arn: "arn:aws:iam::123456789012:role/nlp",
  image_uri: "123456789012.dkr.ecr.eu-west-1.amazonaws.com/nlp:1",
  cache_bucket: "studio-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
};

function appWith({
  fleetSecret,
  repositories = MemoryWorkflowRepositories.create(),
}: {
  fleetSecret: string;
  repositories?: WorkflowRepositories;
}): Promise<WorkflowModule> {
  return WorkflowModule.create({
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>(
        { getForProject: async () => ({}) },
        "ModelProviderApi",
      ),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
    },
    config: {
      nlpServiceUrl: "http://engine.test:5561",
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
      relayTurnCeilingMs: void 0,
      publicBaseUrl: "https://app.test",
      nlpCodeBlockTimeoutSeconds: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (handle, build) =>
      build(handle === WorkflowModule.secrets.nlpLambdaFleet ? fleetSecret : undefined),
    ),
    repositories,
  });
}

/** The fingerprint the app derives from `fleet` and the config above. */
function fleetFingerprint(): string {
  return studioLambdaConfigFingerprint(
    buildStudioLambdaConfig({
      fields: {
        region: fleet.AWS_REGION,
        accessKeyId: fleet.AWS_ACCESS_KEY_ID,
        secretAccessKey: fleet.AWS_SECRET_ACCESS_KEY,
        roleArn: fleet.role_arn,
        imageUri: fleet.image_uri,
        cacheBucket: fleet.cache_bucket,
        subnetIds: fleet.subnet_ids,
        securityGroupIds: fleet.security_group_ids,
      },
      langwatchEndpoint: "https://app.test",
      codeBlockTimeoutRawValue: undefined,
      stagingThresholdBytesRawValue: undefined,
      stagingTtlSecondsRawValue: 600,
    }),
  );
}

const aliveEvent = { type: "is_alive", payload: {} } as const;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  lambda.sent.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a deployment that describes its per-project fleet", () => {
  /** @scenario "A complete Lambda fleet configuration composes the Lambda path" */
  it("runs the studio graph on the project's own function, not at the address", async () => {
    const repositories = MemoryWorkflowRepositories.create();
    await repositories.nlpLambdaArns.set({
      key: `${NLP_LAMBDA_ARN_CACHE_PREFIX}project_1`,
      value: JSON.stringify({
        arn: FUNCTION_ARN,
        imageUri: fleet.image_uri,
        configFingerprint: fleetFingerprint(),
      }),
      ttlSeconds: 600,
    });
    const app = await appWith({ fleetSecret: JSON.stringify(fleet), repositories });
    const received: StudioServerEvent[] = [];

    await app.postStudioEvent({
      projectId: "project_1",
      event: aliveEvent,
      onEvent: (event) => received.push(event),
    });

    const [command] = lambda.sent;
    if (!(command instanceof InvokeWithResponseStreamCommand)) {
      throw new Error("expected one streaming invoke");
    }
    expect(command.input.FunctionName).toBe(FUNCTION_ARN);
    const payload = command.input.Payload;
    expect(typeof payload).toBe("string");
    expect(JSON.parse(typeof payload === "string" ? payload : "{}")).toMatchObject({
      rawPath: "/go/studio/execute",
    });
    expect(received).toContainEqual(expect.objectContaining({ type: "is_alive_response" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a deployment that names a fleet it does not describe", () => {
  /** @scenario "A named but unusable fleet refuses instead of falling back" */
  it("refuses a studio run whose fleet is not valid JSON, by name", async () => {
    const app = await appWith({ fleetSecret: "{" });

    await expect(
      app.postStudioEvent({ projectId: "project_1", event: aliveEvent, onEvent: () => void 0 }),
    ).rejects.toThrow(/fleet configuration is not valid JSON/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lambda.sent).toEqual([]);
  });

  /** @scenario "A named but unusable fleet refuses instead of falling back" */
  it("refuses a studio run whose fleet is missing fields, by name", async () => {
    const app = await appWith({ fleetSecret: JSON.stringify({ AWS_REGION: "eu-west-1" }) });

    await expect(
      app.postStudioEvent({ projectId: "project_1", event: aliveEvent, onEvent: () => void 0 }),
    ).rejects.toThrow(/fleet configuration is missing required fields/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lambda.sent).toEqual([]);
  });
});

describe("when a scenario asks whether this deployment has per-project engines", () => {
  it("answers yes once a fleet is described", async () => {
    const app = await appWith({ fleetSecret: JSON.stringify(fleet) });

    expect(app.hasPerProjectEngines()).toBe(true);
  });

  it("answers yes for a named but unusable fleet, so the turn relays and refuses by name", async () => {
    const app = await appWith({ fleetSecret: "{" });

    expect(app.hasPerProjectEngines()).toBe(true);
  });
});
