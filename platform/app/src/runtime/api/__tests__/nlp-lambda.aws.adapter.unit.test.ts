import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  LambdaClient,
  type FunctionConfiguration,
  type GetFunctionCommandOutput,
} from "@aws-sdk/client-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAMBDA_ARN_CACHE_TTL_MS,
  NlpLambdaAwsClientPort,
  NlpLambdaRuntime,
  resolveNlpLambdaRuntimeConfig,
  type NlpLambdaArnCache,
} from "../nlp-lambda";

function installLambdaSendMock() {
  const send = vi.fn<(command: unknown) => Promise<GetFunctionCommandOutput>>();
  Object.defineProperty(LambdaClient.prototype, "send", {
    configurable: true,
    value: send,
  });
  return send;
}

function installLogsSendMock() {
  const send = vi.fn<(command: unknown) => Promise<{ $metadata: {} }>>();
  Object.defineProperty(CloudWatchLogsClient.prototype, "send", {
    configurable: true,
    value: send,
  });
  return send;
}

const IMAGE_V1 = "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:v1";
const IMAGE_V2 = "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:v2";
const ARN = "arn:aws:lambda:us-east-1:123456789012:function:test-function";

const activeConfiguration = {
  FunctionArn: ARN,
  State: "Active",
  LastUpdateStatus: "Successful",
} satisfies FunctionConfiguration;

function getFunctionOutput(imageUri: string, arn = ARN): GetFunctionCommandOutput {
  return {
    $metadata: {},
    Configuration: { ...activeConfiguration, FunctionArn: arn },
    Code: { ImageUri: imageUri },
  };
}

function pollOutput(arn = ARN): GetFunctionCommandOutput {
  return { $metadata: {}, Configuration: { ...activeConfiguration, FunctionArn: arn } };
}

function runtimeConfig(imageUri: string) {
  return resolveNlpLambdaRuntimeConfig({
    BASE_HOST: "http://localhost:5560",
    LANGWATCH_NLP_LAMBDA_CONFIG: JSON.stringify({
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      AWS_REGION: "us-east-1",
      role_arn: "arn:aws:iam::123456789012:role/test-role",
      image_uri: imageUri,
      cache_bucket: "test-bucket",
      subnet_ids: ["subnet-123"],
      security_group_ids: ["sg-123"],
    }),
  });
}

class TestNlpLambdaAwsClients extends NlpLambdaAwsClientPort {
  private readonly lambda = new LambdaClient({ maxAttempts: 6 });

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

function createRuntime(
  imageUri = IMAGE_V1,
  redis: NlpLambdaArnCache | null = null,
): NlpLambdaRuntime {
  return NlpLambdaRuntime.create({
    config: runtimeConfig(imageUri),
    redis,
    awsClients: new TestNlpLambdaAwsClients(),
  });
}

class TestArnCache implements NlpLambdaArnCache {
  readonly values = new Map<string, string>();
  readonly getCalls: string[] = [];
  readonly setexCalls: Array<{ key: string; seconds: number; value: string }> = [];
  readonly delCalls: string[] = [];
  failGet = false;

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    if (this.failGet) {
      throw new Error("Redis unavailable");
    }
    return this.values.get(key) ?? null;
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    this.setexCalls.push({ key, seconds, value });
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    this.delCalls.push(key);
    return this.values.delete(key) ? 1 : 0;
  }
}

function mockSuccessfulResolution(
  send: ReturnType<typeof installLambdaSendMock>,
  imageUri: string,
  arn = ARN,
) {
  return send
    .mockResolvedValueOnce(getFunctionOutput(imageUri, arn))
    .mockResolvedValueOnce(getFunctionOutput(imageUri, arn))
    .mockResolvedValueOnce(pollOutput(arn));
}

describe("NLP Lambda ARN resolution", () => {
  let lambdaSend: ReturnType<typeof installLambdaSendMock>;

  beforeEach(() => {
    lambdaSend = installLambdaSendMock();
    installLogsSendMock().mockResolvedValue({ $metadata: {} });
  });

  afterEach(() => {
    Reflect.deleteProperty(LambdaClient.prototype, "send");
    Reflect.deleteProperty(CloudWatchLogsClient.prototype, "send");
    vi.restoreAllMocks();
  });

  it("creates a Lambda client with cold-start retry capacity", async () => {
    const client = createRuntime().createLambdaClient();
    expect(await client.config.maxAttempts()).toBe(6);
  });

  it("recovers when create races another Lambda provisioner", async () => {
    lambdaSend
      .mockResolvedValueOnce({ $metadata: {} })
      .mockRejectedValueOnce(new Error("already exist"))
      .mockResolvedValueOnce(pollOutput())
      .mockResolvedValueOnce(pollOutput());

    await expect(createRuntime().resolveTarget("project-a")).resolves.toBe(ARN);
  });

  it("collapses a concurrent project burst into one AWS resolution", async () => {
    let resolveFirst: ((value: GetFunctionCommandOutput) => void) | undefined;
    const send = lambdaSend
      .mockImplementationOnce(
        () =>
          new Promise<GetFunctionCommandOutput>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(getFunctionOutput(IMAGE_V1));
    const runtime = createRuntime();
    const calls = Array.from({ length: 20 }, () => runtime.resolveTarget("project-a"));

    await new Promise<void>((resolve) => setImmediate(resolve));
    if (resolveFirst === undefined) {
      throw new Error("AWS resolution did not start");
    }
    resolveFirst(getFunctionOutput(IMAGE_V1));

    await expect(Promise.all(calls)).resolves.toEqual(Array(20).fill(ARN));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not retain a failed resolution in memory", async () => {
    const send = lambdaSend
      .mockRejectedValueOnce(new Error("unexpected AWS error"))
      .mockRejectedValueOnce(new Error("hard create failure"))
      .mockResolvedValueOnce(getFunctionOutput(IMAGE_V1))
      .mockResolvedValueOnce(getFunctionOutput(IMAGE_V1))
      .mockResolvedValueOnce(pollOutput());
    const runtime = createRuntime();

    await expect(runtime.resolveTarget("project-a")).rejects.toThrow("hard create failure");
    const callsAfterFailure = send.mock.calls.length;
    await expect(runtime.resolveTarget("project-a")).resolves.toBe(ARN);
    expect(send.mock.calls.length).toBeGreaterThan(callsAfterFailure);
  });

  describe("injected Redis cache parity", () => {
    it("stores the ARN at the legacy lambda_arn key with a 600-second TTL", async () => {
      const redis = new TestArnCache();
      mockSuccessfulResolution(lambdaSend, IMAGE_V1);

      await expect(createRuntime(IMAGE_V1, redis).resolveTarget("project-a")).resolves.toBe(ARN);

      expect(redis.setexCalls).toEqual([
        expect.objectContaining({ key: "lambda_arn:project-a", seconds: 600 }),
      ]);
    });

    it("lets a second runtime instance hit the shared Redis entry without AWS", async () => {
      const redis = new TestArnCache();
      const send = mockSuccessfulResolution(lambdaSend, IMAGE_V1);
      await createRuntime(IMAGE_V1, redis).resolveTarget("project-a");
      const callsAfterFirstRuntime = send.mock.calls.length;

      await expect(createRuntime(IMAGE_V1, redis).resolveTarget("project-a")).resolves.toBe(ARN);

      expect(send.mock.calls.length).toBe(callsAfterFirstRuntime);
    });

    it("falls back to AWS when the shared entry is malformed", async () => {
      const redis = new TestArnCache();
      redis.values.set("lambda_arn:project-a", "not-json");
      const send = mockSuccessfulResolution(lambdaSend, IMAGE_V1);

      await expect(createRuntime(IMAGE_V1, redis).resolveTarget("project-a")).resolves.toBe(ARN);

      expect(send).toHaveBeenCalledTimes(3);
      expect(redis.setexCalls).toHaveLength(1);
    });

    it("falls back to AWS when Redis read fails", async () => {
      const redis = new TestArnCache();
      redis.failGet = true;
      const send = mockSuccessfulResolution(lambdaSend, IMAGE_V1);

      await expect(createRuntime(IMAGE_V1, redis).resolveTarget("project-a")).resolves.toBe(ARN);

      expect(send).toHaveBeenCalledTimes(3);
    });

    it("deletes an image-mismatched entry before refreshing it", async () => {
      const redis = new TestArnCache();
      redis.values.set(
        "lambda_arn:project-a",
        JSON.stringify({ arn: "arn:aws:lambda:old", imageUri: IMAGE_V1 }),
      );
      mockSuccessfulResolution(lambdaSend, IMAGE_V2, "arn:aws:lambda:new");

      await expect(createRuntime(IMAGE_V2, redis).resolveTarget("project-a")).resolves.toBe(
        "arn:aws:lambda:new",
      );

      expect(redis.delCalls).toEqual(["lambda_arn:project-a"]);
      expect(redis.setexCalls[0]).toEqual(
        expect.objectContaining({
          key: "lambda_arn:project-a",
          value: JSON.stringify({ arn: "arn:aws:lambda:new", imageUri: IMAGE_V2 }),
        }),
      );
    });
  });

  it("keeps the minute-scale memory TTL contract", () => {
    expect(LAMBDA_ARN_CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
