/**
 * What the synchronous engine invoke reports: the engine's own status on both lanes, and the
 * caller's deadline and cancellation honoured on both.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
import { describe, expect, it } from "vitest";

import { AwsNlpLambdaInvokeChannel } from "../aws.nlp-lambda-invoke.channel.ts";
import {
  type NlpLambdaInvoke,
  type NlpLambdaInvokeResult,
  type NlpPayloadStaging,
  type StagedNlpPayload,
} from "../nlp-lambda.channel.ts";
import {
  NlpInvokeAbortedError,
  NlpInvokeTimeoutError,
  NlpInvokeTransportAdapter,
} from "../workflow-nlp-lambda.channel.ts";

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";
const URL_TARGET = "http://nlpgo.test";
const SEPARATOR = "\u0000".repeat(8);
const CONFIG = { stagingThresholdBytes: 100, stagingTtlSeconds: 600, maxPayloadBytes: 16_000_000 };

function lwa(status: number, body: string): string {
  return `{"statusCode":${status},"headers":{}}${SEPARATOR}${body}`;
}

class AnsweringLambda implements NlpLambdaInvoke {
  invoked = 0;
  constructor(private readonly answer: () => Promise<NlpLambdaInvokeResult>) {}
  invoke(): Promise<NlpLambdaInvokeResult> {
    this.invoked += 1;
    return this.answer();
  }
}

class CountingStaging implements NlpPayloadStaging {
  staged = 0;
  discarded = 0;
  stage(): Promise<StagedNlpPayload> {
    this.staged += 1;
    return Promise.resolve({
      url: "https://s3.test/staged",
      discard: async () => void this.discarded++,
    });
  }
}

function overLambda(result: NlpLambdaInvokeResult) {
  const lambda = new AnsweringLambda(() => Promise.resolve(result));
  return NlpInvokeTransportAdapter.create({ target: ARN, config: CONFIG, lambda });
}

/** Never settles until the signal it was given aborts, as the SDK and fetch behave. */
function hangingUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

const POST = { path: "/go/studio/execute_sync", method: "POST", body: "{}" } as const;

describe("NlpInvokeTransportAdapter's answer on the Lambda lane", () => {
  /** @scenario "An engine error is reported as an error" */
  it("reports the engine's prelude status, not the invocation's 200", async () => {
    const response = await overLambda({ statusCode: 200, payload: lwa(500, '{"error":"x"}') }).send(
      POST,
    );

    expect(response).toMatchObject({ ok: false, status: 500, statusText: "Internal Server Error" });
    expect(await response.text()).toBe('{"error":"x"}');
  });

  /** @scenario "An engine success is reported as a success" */
  it("reports a success with the body after the prelude", async () => {
    const response = await overLambda({ statusCode: 200, payload: lwa(200, '{"a":1}') }).send(POST);

    expect(response).toMatchObject({ ok: true, status: 200, statusText: "OK" });
    expect(await response.json()).toEqual({ a: 1 });
  });

  /** @scenario "A crash inside the function is not a success" */
  it("reports a FunctionError as a 502 named by the error", async () => {
    const response = await overLambda({
      statusCode: 200,
      functionError: "Unhandled",
      payload: '{"errorMessage":"Runtime exited"}',
    }).send(POST);

    expect(response).toMatchObject({ ok: false, status: 502, statusText: "Unhandled" });
  });

  /** @scenario "A response with no prelude is still read" */
  it("reads a payload with no prelude whole, under the invocation's status", async () => {
    const response = await overLambda({ statusCode: 200, payload: '{"a":1}' }).send(POST);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":1}');
  });

  /** @scenario "An empty body after the prelude stays empty" */
  it("answers an empty body, never the prelude", async () => {
    const response = await overLambda({ statusCode: 200, payload: lwa(204, "") }).send(POST);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  /** @scenario "Both lanes describe the same engine answer identically" */
  it("describes an engine answer as the HTTP lane does", async () => {
    const overHttp = NlpInvokeTransportAdapter.create({
      target: URL_TARGET,
      config: CONFIG,
      fetch: () =>
        Promise.resolve(new Response("{}", { status: 422, statusText: "Unprocessable Entity" })),
    });
    const http = await overHttp.send(POST);
    const lambda = await overLambda({ statusCode: 200, payload: lwa(422, "{}") }).send(POST);

    expect({ status: lambda.status, statusText: lambda.statusText }).toEqual({
      status: http.status,
      statusText: http.statusText,
    });
  });
});

describe("NlpInvokeTransportAdapter's limits", () => {
  /** @scenario "A call past its deadline is abandoned on the Lambda lane" */
  it("raises a timeout when the invoke outlives the deadline", async () => {
    const lambda: NlpLambdaInvoke = { invoke: ({ signal }) => hangingUntilAborted(signal) };
    const adapter = NlpInvokeTransportAdapter.create({ target: ARN, config: CONFIG, lambda });

    await expect(adapter.send({ ...POST, timeoutMs: 20 })).rejects.toBeInstanceOf(
      NlpInvokeTimeoutError,
    );
  });

  /** @scenario "A call past its deadline is abandoned on the HTTP lane" */
  it("raises a timeout when the fetch outlives the deadline", async () => {
    const adapter = NlpInvokeTransportAdapter.create({
      target: URL_TARGET,
      config: CONFIG,
      fetch: (_url, init) => hangingUntilAborted(init?.signal ?? undefined),
    });

    await expect(adapter.send({ ...POST, timeoutMs: 20 })).rejects.toBeInstanceOf(
      NlpInvokeTimeoutError,
    );
  });

  /** @scenario "A cancelled turn stops the call on the Lambda lane" */
  it("raises a cancellation when the caller aborts mid-invoke", async () => {
    const lambda: NlpLambdaInvoke = { invoke: ({ signal }) => hangingUntilAborted(signal) };
    const adapter = NlpInvokeTransportAdapter.create({ target: ARN, config: CONFIG, lambda });
    const controller = new AbortController();

    const sent = adapter.send({ ...POST, signal: controller.signal });
    controller.abort();

    await expect(sent).rejects.toBeInstanceOf(NlpInvokeAbortedError);
  });

  /** @scenario "A turn cancelled before it is sent uploads nothing" */
  it("stages and invokes nothing for a caller that already gave up", async () => {
    const lambda = new AnsweringLambda(() => Promise.resolve({ statusCode: 200, payload: "" }));
    const staging = new CountingStaging();
    const adapter = NlpInvokeTransportAdapter.create({
      target: ARN,
      config: CONFIG,
      lambda,
      staging,
    });

    await expect(
      adapter.send({ ...POST, body: "x".repeat(500), projectId: "p", signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(NlpInvokeAbortedError);
    expect({ staged: staging.staged, invoked: lambda.invoked }).toEqual({ staged: 0, invoked: 0 });
  });

  /** @scenario "A staged payload survives a retry and is reaped once" */
  it("keeps a staged body across a refused attempt and discards it once", async () => {
    let sends = 0;
    const client = {
      send: () => {
        sends += 1;
        return sends === 1
          ? Promise.reject(Object.assign(new Error("throttled"), { name: "ThrottlingException" }))
          : Promise.resolve({ StatusCode: 200, Payload: Buffer.from(lwa(200, "{}")) });
      },
    } as never;
    const staging = new CountingStaging();
    const adapter = NlpInvokeTransportAdapter.create({
      target: ARN,
      config: CONFIG,
      lambda: AwsNlpLambdaInvokeChannel.create({ lambda: client, wait: () => Promise.resolve() }),
      staging,
    });

    const response = await adapter.send({ ...POST, body: "x".repeat(500), projectId: "p" });

    expect(response.status).toBe(200);
    expect({ sends, staged: staging.staged, discarded: staging.discarded }).toEqual({
      sends: 2,
      staged: 1,
      discarded: 1,
    });
  });
});
