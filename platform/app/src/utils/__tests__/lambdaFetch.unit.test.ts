import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  NlpLambdaAwsClientPort,
  NlpLambdaPayloadStagingPort,
  NlpLambdaRuntime,
  NlpLambdaStagedPayload,
  type NlpLambdaPayloadStageRequest,
} from "~/runtime/api/nlp-lambda";
import { InvokePayloadTooLargeError, lambdaFetch } from "../lambdaFetch";

type LambdaTestState = {
  invokePayloads: string[];
  rejectWith: Error | undefined;
};

const lambdaState = vi.hoisted((): LambdaTestState => ({
  invokePayloads: [],
  rejectWith: undefined,
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  InvokeCommand: class {
    constructor(readonly input: { Payload: string }) {}
  },
  InvokeWithResponseStreamCommand: class {},
  LambdaClient: class {
    send = async (command: { input: { Payload: string } }) => {
      lambdaState.invokePayloads.push(command.input.Payload);
      if (lambdaState.rejectWith !== undefined) {
        throw lambdaState.rejectWith;
      }
      return { StatusCode: 200, Payload: Buffer.from('{"ok":true}', "utf-8") };
    };
  },
  CreateFunctionCommand: class {},
  GetFunctionCommand: class {},
  UpdateFunctionCodeCommand: class {},
}));

class TestNlpLambdaAwsClients extends NlpLambdaAwsClientPort {
  private readonly lambda = new LambdaClient({});

  private readonly logs = new CloudWatchLogsClient({});

  createLambdaClient(): LambdaClient {
    return this.lambda;
  }

  createLogsClient(): CloudWatchLogsClient {
    return this.logs;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";

class TestStagedPayload extends NlpLambdaStagedPayload {
  constructor(
    readonly url: string,
    private readonly onDelete: () => void,
  ) {
    super();
  }

  async delete(): Promise<void> {
    this.onDelete();
  }
}

class TestPayloadStagingPort extends NlpLambdaPayloadStagingPort {
  readonly stageCalls: NlpLambdaPayloadStageRequest[] = [];
  readonly deletedUrls: string[] = [];

  async stage(input: NlpLambdaPayloadStageRequest): Promise<NlpLambdaStagedPayload> {
    this.stageCalls.push(input);
    const url = `https://s3.example/${encodeURIComponent(input.keyPrefix)}?signed=yes`;
    return new TestStagedPayload(url, () => this.deletedUrls.push(url));
  }
}

function createRuntime(
  input: {
    thresholdBytes?: number;
    ttlSeconds?: number;
    maxPayloadBytes?: number;
  } = {},
): { runtime: NlpLambdaRuntime; staging: TestPayloadStagingPort } {
  const staging = new TestPayloadStagingPort();
  return {
    runtime: NlpLambdaRuntime.create({
      config: {
        baseHost: undefined,
        deployment: {
          AWS_ACCESS_KEY_ID: "access-key",
          AWS_SECRET_ACCESS_KEY: "secret-key",
          AWS_REGION: "eu-central-1",
          role_arn: "arn:aws:iam::123:role/nlp",
          image_uri: "registry.example/nlp:latest",
          cache_bucket: "nlp-cache",
          subnet_ids: [],
          security_group_ids: [],
        },
        serviceUrl: undefined,
        staging: {
          thresholdBytes: "thresholdBytes" in input ? input.thresholdBytes : 1000,
          ttlSeconds: input.ttlSeconds ?? 600,
        },
        maxPayloadBytes: input.maxPayloadBytes ?? 16_000_000,
        studioCacheKeySalt: undefined,
      },
      redis: null,
      awsClients: new TestNlpLambdaAwsClients(),
      payloadStaging: staging,
    }),
    staging,
  };
}

function lastEnvelope(): Record<string, unknown> {
  return JSON.parse(lambdaState.invokePayloads.at(-1) ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  lambdaState.invokePayloads.length = 0;
  lambdaState.rejectWith = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lambdaFetch", () => {
  it("delegates inline Lambda invocations to the runtime-owned boundary", async () => {
    const { runtime, staging } = createRuntime();
    const body = JSON.stringify({ small: "payload" });

    await lambdaFetch(runtime, ARN, "/go/studio/execute_sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      projectId: "project_a",
    });

    expect(staging.stageCalls).toHaveLength(0);
    expect(lastEnvelope().body).toBe(body);
  });

  it("stages oversized Lambda invocations and deletes the payload after success", async () => {
    const { runtime, staging } = createRuntime();
    const body = JSON.stringify({ traces: "x".repeat(2000) });

    await lambdaFetch(runtime, ARN, "/go/studio/execute_sync", {
      method: "POST",
      body,
      projectId: "project_b",
    });

    expect(staging.stageCalls).toEqual([
      expect.objectContaining({
        projectId: "project_b",
        keyPrefix: "nlpgo-staging/project_b",
        ttlSeconds: 600,
      }),
    ]);
    expect(staging.stageCalls[0]?.serialized.toString("utf-8")).toBe(body);
    expect(lastEnvelope().body).toBe("");
    expect(staging.deletedUrls).toHaveLength(1);
  });

  it("deletes a staged payload after a failed Lambda invocation", async () => {
    const { runtime, staging } = createRuntime();
    lambdaState.rejectWith = new Error("lambda boom");

    await expect(
      lambdaFetch(runtime, ARN, "/go/studio/execute_sync", {
        method: "POST",
        body: JSON.stringify({ traces: "x".repeat(2000) }),
        projectId: "project_failure",
      }),
    ).rejects.toThrow("lambda boom");

    expect(staging.deletedUrls).toHaveLength(1);
  });

  it("uses the serialized envelope size for its staging decision", async () => {
    const { runtime, staging } = createRuntime({ thresholdBytes: 505 });
    const body = '"'.repeat(500);

    await lambdaFetch(runtime, ARN, "/go/studio/execute_sync", {
      method: "POST",
      body,
      projectId: "project_escape",
    });

    expect(staging.stageCalls).toHaveLength(1);
  });

  it("uses the five-megabyte staging fallback when no semantic threshold is set", async () => {
    const { runtime, staging } = createRuntime({ thresholdBytes: undefined });
    const body = JSON.stringify({ traces: "x".repeat(5 * 1024 * 1024 + 64) });

    await lambdaFetch(runtime, ARN, "/go/studio/execute_sync", {
      method: "POST",
      body,
      projectId: "project_fallback",
    });

    expect(staging.stageCalls).toHaveLength(1);
  });

  it("rejects a body larger than the injected semantic maximum before staging", async () => {
    const { runtime, staging } = createRuntime({ maxPayloadBytes: 2000 });

    await expect(
      lambdaFetch(runtime, ARN, "/go/studio/execute_sync", {
        method: "POST",
        body: JSON.stringify({ traces: "x".repeat(5000) }),
        projectId: "project_oversized",
      }),
    ).rejects.toBeInstanceOf(InvokePayloadTooLargeError);

    expect(staging.stageCalls).toHaveLength(0);
    expect(lambdaState.invokePayloads).toHaveLength(0);
  });

  it("preserves the self-hosted HTTP fallback without staging", async () => {
    const { runtime, staging } = createRuntime();
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await lambdaFetch(runtime, "http://localhost:5561", "/go/studio/execute_sync", {
      method: "POST",
      body: JSON.stringify({ traces: "x".repeat(2000) }),
      projectId: "project_selfhosted",
    });

    expect(staging.stageCalls).toHaveLength(0);
    expect(lambdaState.invokePayloads).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
