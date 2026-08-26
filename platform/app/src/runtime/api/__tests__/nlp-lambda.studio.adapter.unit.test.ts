import { studioClientEventSchema } from "@langwatch/workflow-contract";
import {
  LambdaClient,
  type InvokeWithResponseStreamCommandOutput,
} from "@aws-sdk/client-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invokeStudioNlp,
  NlpLambdaErrorReportingPort,
  NlpLambdaPayloadStagingPort,
  NlpLambdaRuntime,
  NlpLambdaStagedPayload,
  resolveNlpLambdaRuntimeConfig,
  type NlpLambdaPayloadStageRequest,
} from "../nlp-lambda";

const event = studioClientEventSchema.parse({ type: "is_alive", payload: {} });

function installLambdaStreamSendMock() {
  const send =
    vi.fn<(command: unknown) => Promise<InvokeWithResponseStreamCommandOutput>>();
  Object.defineProperty(LambdaClient.prototype, "send", {
    configurable: true,
    value: send,
  });
  return send;
}

class TestStagedPayload extends NlpLambdaStagedPayload {
  constructor(
    readonly url: string,
    private readonly deleted: string[],
  ) {
    super();
  }

  async delete(): Promise<void> {
    this.deleted.push(this.url);
  }
}

class TestPayloadStagingPort extends NlpLambdaPayloadStagingPort {
  readonly calls: NlpLambdaPayloadStageRequest[] = [];
  readonly deleted: string[] = [];

  async stage(input: NlpLambdaPayloadStageRequest): Promise<NlpLambdaStagedPayload> {
    this.calls.push(input);
    return new TestStagedPayload("https://s3.example/staged", this.deleted);
  }
}

class TestErrorReportingPort extends NlpLambdaErrorReportingPort {
  readonly reports: Array<{ error: Error; extra: Record<string, unknown> }> = [];

  capture(input: { error: Error; extra: Record<string, unknown> }): void {
    this.reports.push(input);
  }
}

function createLambdaRuntime(
  input: {
    thresholdBytes?: number;
    payloadStaging?: NlpLambdaPayloadStagingPort;
    errorReporting?: NlpLambdaErrorReportingPort;
  } = {},
): NlpLambdaRuntime {
  return NlpLambdaRuntime.create({
    config: resolveNlpLambdaRuntimeConfig({
      LANGEVALS_STAGING_THRESHOLD_BYTES: input.thresholdBytes,
      LANGWATCH_NLP_LAMBDA_CONFIG: JSON.stringify({
        AWS_ACCESS_KEY_ID: "access-key",
        AWS_SECRET_ACCESS_KEY: "secret-key",
        AWS_REGION: "eu-central-1",
        role_arn: "arn:aws:iam::123:role/nlp",
        image_uri: "registry.example/nlp:latest",
        cache_bucket: "nlp-cache",
        subnet_ids: [],
        security_group_ids: [],
      }),
    }),
    redis: null,
    payloadStaging: input.payloadStaging,
    errorReporting: input.errorReporting,
  });
}

function streamResponse(payload: Uint8Array): InvokeWithResponseStreamCommandOutput {
  return {
    $metadata: {},
    EventStream: {
      async *[Symbol.asyncIterator]() {
        yield { PayloadChunk: { Payload: payload } };
      },
    },
  };
}

function withPrelude(prelude: string, body: string): Uint8Array {
  const preludeBytes = new TextEncoder().encode(prelude);
  const bodyBytes = new TextEncoder().encode(body);
  const payload = new Uint8Array(preludeBytes.length + 8 + bodyBytes.length);
  payload.set(preludeBytes);
  payload.set(bodyBytes, preludeBytes.length + 8);
  return payload;
}

describe("invokeStudioNlp", () => {
  let lambdaSend: ReturnType<typeof installLambdaStreamSendMock>;

  const nlpLambda = NlpLambdaRuntime.create({
    config: resolveNlpLambdaRuntimeConfig({
      LANGWATCH_NLP_SERVICE: "http://nlp.internal",
    }),
    redis: null,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    lambdaSend = installLambdaStreamSendMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(LambdaClient.prototype, "send");
    vi.unstubAllGlobals();
  });

  it("preserves the HTTP target, path, payload, and Studio cache header", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('data: {"type":"done"}\n\n'));

    const reader = await invokeStudioNlp(
      nlpLambda,
      "project-a",
      event,
      "monthly-cache-key",
      {
        path: "/go/studio/execute",
        headers: { "X-LangWatch-Origin": "workflow" },
      },
    );

    expect(fetch).toHaveBeenCalledWith("http://nlp.internal/go/studio/execute", {
      method: "POST",
      body: JSON.stringify(event),
      headers: {
        "Content-Type": "application/json",
        "X-S3-Cache-Key": "monthly-cache-key",
        "X-LangWatch-Origin": "workflow",
      },
    });
    await reader.cancel();
  });

  it("does not send an empty Studio cache header", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('data: {"type":"done"}\n\n'));

    const reader = await invokeStudioNlp(nlpLambda, "project-a", event, "");

    expect(fetch).toHaveBeenCalledWith("http://nlp.internal/studio/execute", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "Content-Type": "application/json" },
    });
    await reader.cancel();
  });

  it("streams Lambda Web Adapter payload bytes after stripping its prelude", async () => {
    const lambdaRuntime = createLambdaRuntime();
    vi.spyOn(lambdaRuntime, "resolveTarget").mockResolvedValue(
      "arn:aws:lambda:eu-central-1:123:function:nlpgo-project-a",
    );

    lambdaSend.mockResolvedValue(
      streamResponse(
        withPrelude(JSON.stringify({ statusCode: 200 }), 'data: {"type":"done"}\n\n'),
      ),
    );

    const reader = await invokeStudioNlp(lambdaRuntime, "project-a", event, undefined);
    const chunk = await reader.read();

    expect(chunk.done).toBe(false);
    expect(new TextDecoder().decode(chunk.value)).toBe('data: {"type":"done"}\n\n');
    expect((await reader.read()).done).toBe(true);
  });

  it("preserves the legacy 200 default when the LWA prelude is malformed", async () => {
    const lambdaRuntime = createLambdaRuntime();
    vi.spyOn(lambdaRuntime, "resolveTarget").mockResolvedValue(
      "arn:aws:lambda:eu-central-1:123:function:nlpgo-project-a",
    );
    lambdaSend.mockResolvedValue(
      streamResponse(withPrelude("not-json", 'data: {"type":"done"}\n\n')),
    );

    const reader = await invokeStudioNlp(lambdaRuntime, "project-a", event, undefined);
    const chunk = await reader.read();

    expect(new TextDecoder().decode(chunk.value)).toBe('data: {"type":"done"}\n\n');
    expect((await reader.read()).done).toBe(true);
  });

  it("preserves the legacy empty stream when no LWA separator arrives", async () => {
    const lambdaRuntime = createLambdaRuntime();
    vi.spyOn(lambdaRuntime, "resolveTarget").mockResolvedValue(
      "arn:aws:lambda:eu-central-1:123:function:nlpgo-project-a",
    );
    lambdaSend.mockResolvedValue(
      streamResponse(new TextEncoder().encode('data: {"type":"done"}\n\n')),
    );

    const reader = await invokeStudioNlp(lambdaRuntime, "project-a", event, undefined);
    expect(await reader.read()).toEqual({ value: undefined, done: true });
  });

  it("stages and releases an oversized Studio payload through the injected port", async () => {
    const staging = new TestPayloadStagingPort();
    const lambdaRuntime = createLambdaRuntime({
      thresholdBytes: 1,
      payloadStaging: staging,
    });
    vi.spyOn(lambdaRuntime, "resolveTarget").mockResolvedValue(
      "arn:aws:lambda:eu-central-1:123:function:nlpgo-project-a",
    );
    lambdaSend.mockResolvedValue(
      streamResponse(
        withPrelude(JSON.stringify({ statusCode: 200 }), 'data: {"type":"done"}\n\n'),
      ),
    );

    const reader = await invokeStudioNlp(lambdaRuntime, "project-a", event, undefined, {
      supportsStaging: true,
    });
    await reader.read();
    await reader.read();

    expect(staging.calls).toEqual([
      expect.objectContaining({
        projectId: "project-a",
        keyPrefix: "studio-staging/project-a",
        ttlSeconds: 600,
      }),
    ]);
    expect(staging.deleted).toEqual(["https://s3.example/staged"]);
  });

  it("reports Lambda stream errors through the injected error-reporting port", async () => {
    const errors = new TestErrorReportingPort();
    const lambdaRuntime = createLambdaRuntime({ errorReporting: errors });
    vi.spyOn(lambdaRuntime, "resolveTarget").mockResolvedValue(
      "arn:aws:lambda:eu-central-1:123:function:nlpgo-project-a",
    );
    const response: InvokeWithResponseStreamCommandOutput = {
      $metadata: {},
      EventStream: {
        async *[Symbol.asyncIterator]() {
          yield { InvokeComplete: { ErrorCode: "Unhandled", ErrorDetails: "boom" } };
        },
      },
    };
    lambdaSend.mockResolvedValue(response);

    const reader = await invokeStudioNlp(lambdaRuntime, "project-a", event, undefined);
    await expect(reader.read()).rejects.toThrow("Failed run workflow: Unhandled");

    expect(errors.reports).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ message: "Failed run workflow: Unhandled" }),
        extra: expect.objectContaining({ details: "boom" }),
      }),
    ]);
  });
});
