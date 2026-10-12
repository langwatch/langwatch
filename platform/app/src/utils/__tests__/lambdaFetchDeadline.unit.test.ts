/**
 * The deadline and the cancellation an nlpgo call carries, on both lanes.
 *
 * A scenario turn's budget and a stopped run both have to reach the transport:
 * without them the Lambda lane held an invoke until AWS's own 15-minute
 * ceiling, and a stopped run kept a worker parked on a socket with no reader
 * left. A caller also has to be able to tell the two apart from a transport
 * error, because they classify differently in the surface a customer reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendCalls, stageCalls, lambdaState, mockEnv } = vi.hoisted(() => ({
  sendCalls: [] as { options: { abortSignal?: AbortSignal } }[],
  stageCalls: [] as unknown[],
  lambdaState: {
    /** Scripted per test, and handed the options the SDK would receive. */
    handler: null as
      | null
      | ((options: { abortSignal?: AbortSignal }) => Promise<unknown>),
  },
  mockEnv: {
    LANGEVALS_STAGING_THRESHOLD_BYTES: 1000,
    LANGEVALS_STAGING_TTL_SECONDS: 600,
    EVAL_MAX_PAYLOAD_BYTES: 16_000_000,
  } as Record<string, unknown>,
}));

vi.mock("../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@aws-sdk/client-lambda", () => ({
  InvokeCommand: class {
    constructor(public input: { Payload: string }) {}
  },
}));

vi.mock("../../optimization_studio/server/lambda", () => ({
  createLambdaClient: vi.fn(() => ({
    send: vi.fn(
      async (_cmd: unknown, options: { abortSignal?: AbortSignal }) => {
        sendCalls.push({ options: options ?? {} });
        if (!lambdaState.handler) {
          throw new Error("test did not script a Lambda response");
        }
        return await lambdaState.handler(options ?? {});
      },
    ),
  })),
}));

vi.mock("../../server/s3/stagePayload", () => ({
  STAGED_PAYLOAD_HEADER: "X-Payload-S3-URL",
  stagePayloadToS3: vi.fn(async (input: unknown) => {
    stageCalls.push(input);
    return {
      s3Client: {},
      s3Bucket: "bucket",
      key: "key",
      stagedUrl: "https://s3.example/key?signed=yes",
    };
  }),
  deleteStagedObject: vi.fn(async () => undefined),
}));

import {
  LambdaFetchAbortedError,
  LambdaFetchTimeoutError,
  lambdaFetch,
} from "../lambdaFetch";

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";
const URL_TARGET = "http://localhost:5561";
const PATH = "/go/studio/execute_sync";

/**
 * A transport that answers nothing until its signal aborts, which is how both
 * the AWS client and fetch behave for a call still in flight.
 */
function abortAware(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return; // never settles: the test asserts on the deadline
    if (signal.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      { once: true },
    );
  });
}

function engineNeverAnswers() {
  lambdaState.handler = (options) => abortAware(options.abortSignal);
}

beforeEach(() => {
  sendCalls.length = 0;
  stageCalls.length = 0;
  lambdaState.handler = null;
  mockEnv.LANGEVALS_STAGING_THRESHOLD_BYTES = 1000;
  mockEnv.EVAL_MAX_PAYLOAD_BYTES = 16_000_000;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a deadline on an nlpgo call", () => {
  describe("given a deadline shorter than the engine takes to answer", () => {
    /** @scenario "A call past its deadline is abandoned on the Lambda lane" */
    it("abandons the invoke and says it timed out", async () => {
      engineNeverAnswers();

      const call = lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
        timeoutMs: 30,
      });

      await expect(call).rejects.toBeInstanceOf(LambdaFetchTimeoutError);
    });

    /** @scenario "A call past its deadline is abandoned on the HTTP lane" */
    it("abandons the post and says it timed out", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: { signal?: AbortSignal }) =>
          abortAware(init.signal),
        ),
      );

      const call = lambdaFetch(URL_TARGET, PATH, {
        method: "POST",
        body: "{}",
        timeoutMs: 30,
      });

      await expect(call).rejects.toBeInstanceOf(LambdaFetchTimeoutError);
    });

    it("hands the deadline to the transport rather than only watching it", async () => {
      engineNeverAnswers();

      await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
        timeoutMs: 30,
      }).catch(() => undefined);

      expect(sendCalls[0]!.options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(sendCalls[0]!.options.abortSignal!.aborted).toBe(true);
    });
  });

  describe("given a caller that cancels its own request", () => {
    /** @scenario "A cancelled turn stops the call on the Lambda lane" */
    it("says it was cancelled, not that it timed out", async () => {
      engineNeverAnswers();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);

      const call = lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
        signal: controller.signal,
        // Far enough out that a timeout cannot be what fired.
        timeoutMs: 10_000,
      });

      await expect(call).rejects.toBeInstanceOf(LambdaFetchAbortedError);
    });

    it("says it was cancelled on the HTTP lane too", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: { signal?: AbortSignal }) =>
          abortAware(init.signal),
        ),
      );
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);

      const call = lambdaFetch(URL_TARGET, PATH, {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      });

      await expect(call).rejects.toBeInstanceOf(LambdaFetchAbortedError);
    });
  });

  describe("given a caller whose request is already cancelled", () => {
    /** @scenario "A turn cancelled before it is sent uploads nothing" */
    it("stages nothing and invokes nothing", async () => {
      engineNeverAnswers();
      const controller = new AbortController();
      controller.abort();

      const call = lambdaFetch(ARN, PATH, {
        method: "POST",
        // Large enough that it would be staged if the call got that far.
        body: JSON.stringify({ big: "x".repeat(4000) }),
        projectId: "project-1",
        signal: controller.signal,
      });

      await expect(call).rejects.toBeInstanceOf(LambdaFetchAbortedError);
      expect(stageCalls).toHaveLength(0);
      expect(sendCalls).toHaveLength(0);
    });
  });

  describe("given a caller that sets neither a deadline nor a cancellation", () => {
    /** @scenario "A caller with no deadline is unchanged" */
    it("imposes no deadline on the invoke", async () => {
      lambdaState.handler = async () => ({
        StatusCode: 200,
        Payload: Buffer.from("{}", "utf-8"),
      });

      await lambdaFetch(ARN, PATH, { method: "POST", body: "{}" });

      expect(sendCalls[0]!.options.abortSignal).toBeUndefined();
    });

    it("imposes no deadline on the post", async () => {
      const fetchMock = vi.fn(
        async (_url: string, _init?: { signal?: AbortSignal }) =>
          new Response("{}", { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await lambdaFetch(URL_TARGET, PATH, { method: "POST", body: "{}" });

      expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: undefined });
    });
  });

  describe("given a transport failure that is neither a deadline nor a cancellation", () => {
    it("leaves the original error alone so it is not misread as a timeout", async () => {
      lambdaState.handler = async () => {
        throw Object.assign(new Error("socket hang up"), {
          name: "ECONNRESET",
        });
      };

      const call = lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
        timeoutMs: 10_000,
      });

      await expect(call).rejects.toThrow("socket hang up");
    });
  });
});
