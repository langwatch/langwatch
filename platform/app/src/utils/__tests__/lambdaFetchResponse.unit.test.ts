/**
 * What a caller reads back from an nlpgo invoke, and how many times the
 * customer's code may run to produce it.
 *
 * The per-project function runs the Lambda Web Adapter in RESPONSE_STREAM
 * mode, so the engine's real HTTP status arrives in a JSON prelude ahead of
 * the body; the invoke's own `StatusCode` describes the INVOCATION and is 200
 * whenever AWS ran the function at all. Reading the latter reports every
 * engine error as a success. Mocked at the Lambda client boundary so these are
 * pure checks of lambdaFetch's own reading and retry decisions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendCalls, stageCalls, deleteCalls, lambdaState, mockEnv } = vi.hoisted(
  () => ({
    sendCalls: [] as { payload: string; options: unknown }[],
    stageCalls: [] as unknown[],
    deleteCalls: [] as unknown[],
    lambdaState: {
      /** Scripted per test; returns the invoke result or throws. */
      handler: null as null | (() => Promise<unknown>),
    },
    mockEnv: {
      LANGEVALS_STAGING_THRESHOLD_BYTES: 1000,
      LANGEVALS_STAGING_TTL_SECONDS: 600,
      EVAL_MAX_PAYLOAD_BYTES: 16_000_000,
    } as Record<string, unknown>,
  }),
);

vi.mock("../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@aws-sdk/client-lambda", () => ({
  InvokeCommand: class {
    constructor(public input: { Payload: string }) {}
  },
}));

vi.mock("../../optimization_studio/server/lambda", () => ({
  createLambdaClient: vi.fn(() => ({
    send: vi.fn(
      async (cmd: { input: { Payload: string } }, options: unknown) => {
        sendCalls.push({ payload: cmd.input.Payload, options });
        if (!lambdaState.handler) {
          throw new Error("test did not script a Lambda response");
        }
        return await lambdaState.handler();
      },
    ),
  })),
}));

vi.mock("../../server/s3/stagePayload", () => ({
  STAGED_PAYLOAD_HEADER: "X-Payload-S3-URL",
  stagePayloadToS3: vi.fn(async (input: { keyPrefix: string }) => {
    stageCalls.push(input);
    return {
      s3Client: { _fake: true },
      s3Bucket: "test-staging-bucket",
      key: `${input.keyPrefix}/staged.json`,
      stagedUrl:
        "https://s3.example/test-staging-bucket/staged.json?signed=yes",
    };
  }),
  deleteStagedObject: vi.fn(async (args: unknown) => {
    deleteCalls.push(args);
  }),
}));

import { createLambdaClient } from "../../optimization_studio/server/lambda";
import { lambdaFetch } from "../lambdaFetch";
import { LWA_PRELUDE_SEPARATOR_LEN } from "../lwaPrelude";

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";
const PATH = "/go/studio/execute_sync";

/** An invoke response Payload framed the way the adapter frames one. */
function lwaPayload({ status, body }: { status: number; body: string }) {
  return Buffer.concat([
    Buffer.from(
      JSON.stringify({ statusCode: status, headers: {}, cookies: [] }),
      "utf-8",
    ),
    Buffer.alloc(LWA_PRELUDE_SEPARATOR_LEN),
    Buffer.from(body, "utf-8"),
  ]);
}

/** The engine answered with this status and body; the invocation succeeded. */
function engineAnswers({ status, body }: { status: number; body: string }) {
  lambdaState.handler = async () => ({
    StatusCode: 200,
    Payload: lwaPayload({ status, body }),
  });
}

function named(name: string) {
  return Object.assign(new Error(name), { name });
}

beforeEach(() => {
  sendCalls.length = 0;
  stageCalls.length = 0;
  deleteCalls.length = 0;
  lambdaState.handler = null;
  mockEnv.LANGEVALS_STAGING_THRESHOLD_BYTES = 1000;
  mockEnv.EVAL_MAX_PAYLOAD_BYTES = 16_000_000;
  vi.mocked(createLambdaClient).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the status a caller reads from an nlpgo invoke", () => {
  describe("given nlpgo answers with a 500 and an error body", () => {
    /** @scenario "An engine error is reported as an error" */
    it("reports the call as not ok, with nlpgo's status and body", async () => {
      engineAnswers({ status: 500, body: '{"error":"boom"}' });

      const response = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('{"error":"boom"}');
    });
  });

  describe("given nlpgo answers with a 200 and a result body", () => {
    /** @scenario "An engine success is reported as a success" */
    it("reports the call as ok, with the body and no prelude", async () => {
      engineAnswers({ status: 200, body: '{"result":{"score":1}}' });

      const response = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: { score: 1 } });
      expect(await response.text()).not.toContain("statusCode");
    });
  });

  describe("given the same engine answer over each lane", () => {
    /** @scenario "Both lanes describe the same engine answer identically" */
    it("describes it identically, so a caller's ok branch works on both", async () => {
      const body = '{"error":"unprocessable"}';
      engineAnswers({ status: 422, body });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status: 422 })),
      );

      const overLambda = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });
      const overHttp = await lambdaFetch("http://localhost:5561", PATH, {
        method: "POST",
        body: "{}",
      });

      expect({
        ok: overLambda.ok,
        status: overLambda.status,
        body: await overLambda.text(),
      }).toEqual({
        ok: overHttp.ok,
        status: overHttp.status,
        body: await overHttp.text(),
      });
      expect(overLambda.ok).toBe(false);
    });
  });

  describe("given the function itself raised", () => {
    /** @scenario "A crash inside the function is not a success" */
    it("reports a failed upstream rather than the invocation's 200", async () => {
      lambdaState.handler = async () => ({
        StatusCode: 200,
        FunctionError: "Unhandled",
        Payload: Buffer.from(
          '{"errorMessage":"Runtime exited","errorType":"Runtime.ExitError"}',
          "utf-8",
        ),
      });

      const response = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(502);
      expect(response.statusText).toBe("Unhandled");
    });
  });

  describe("given an invoke response with no prelude", () => {
    /** @scenario "A response with no prelude is still read" */
    it("reads the whole payload as the body and keeps the invocation status", async () => {
      lambdaState.handler = async () => ({
        StatusCode: 200,
        Payload: Buffer.from('{"result":"buffered"}', "utf-8"),
      });

      const response = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"result":"buffered"}');
    });
  });

  describe("given nlpgo answers with a status and no body", () => {
    /** @scenario "An empty body after the prelude stays empty" */
    it("reads an empty body rather than returning the prelude as one", async () => {
      engineAnswers({ status: 204, body: "" });

      const response = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });

      expect(await response.text()).toBe("");
      expect(response.status).toBe(204);
    });
  });

  describe("given AWS refused the invoke outright", () => {
    it("reports the invocation's own failing status", async () => {
      lambdaState.handler = async () => ({
        StatusCode: 429,
        Payload: undefined,
      });

      const response = await lambdaFetch(ARN, PATH, {
        method: "POST",
        body: "{}",
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(429);
    });
  });
});

describe("how many times a turn may run the customer's code", () => {
  describe("given an invoke failure that does not prove the function never ran", () => {
    /** @scenario "An invoke that may have started the function is not retried" */
    it("invokes exactly once and surfaces the error", async () => {
      lambdaState.handler = async () => {
        throw named("ServiceException");
      };

      await expect(
        lambdaFetch(ARN, PATH, { method: "POST", body: "{}" }),
      ).rejects.toThrow("ServiceException");
      expect(sendCalls).toHaveLength(1);
    });

    it("builds its Lambda client with the SDK's own retries switched off", async () => {
      engineAnswers({ status: 200, body: "{}" });

      await lambdaFetch(ARN, PATH, { method: "POST", body: "{}" });

      expect(createLambdaClient).toHaveBeenCalledWith({ maxAttempts: 1 });
    });
  });

  describe("given the control plane throttled the invoke before running it", () => {
    /** @scenario "An invoke the service rejected before running is retried" */
    it("retries, and the function runs the code only on the attempt that lands", async () => {
      let attempts = 0;
      lambdaState.handler = async () => {
        attempts += 1;
        if (attempts < 3) throw named("TooManyRequestsException");
        return {
          StatusCode: 200,
          Payload: lwaPayload({ status: 200, body: '{"ran":1}' }),
        };
      };

      vi.useFakeTimers();
      try {
        const pending = lambdaFetch(ARN, PATH, { method: "POST", body: "{}" });
        await vi.advanceTimersByTimeAsync(30_000);
        const response = await pending;

        expect(sendCalls).toHaveLength(3);
        expect(await response.json()).toEqual({ ran: 1 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up after the allowed attempts rather than retrying forever", async () => {
      lambdaState.handler = async () => {
        throw named("TooManyRequestsException");
      };

      vi.useFakeTimers();
      try {
        const pending = lambdaFetch(ARN, PATH, { method: "POST", body: "{}" });
        const assertion = expect(pending).rejects.toThrow(
          "TooManyRequestsException",
        );
        await vi.advanceTimersByTimeAsync(120_000);
        await assertion;

        expect(sendCalls).toHaveLength(6);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given an oversized body was staged and the first invoke is throttled", () => {
    /** @scenario "A staged payload survives a retry and is reaped once" */
    it("leaves the staged object in place for the retry and deletes it once", async () => {
      const big = "x".repeat(4000);
      let attempts = 0;
      lambdaState.handler = async () => {
        attempts += 1;
        if (attempts < 2) throw named("TooManyRequestsException");
        return {
          StatusCode: 200,
          Payload: lwaPayload({ status: 200, body: "{}" }),
        };
      };

      vi.useFakeTimers();
      try {
        const pending = lambdaFetch(ARN, PATH, {
          method: "POST",
          body: JSON.stringify({ big }),
          projectId: "project-1",
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await pending;
      } finally {
        vi.useRealTimers();
      }

      expect(stageCalls).toHaveLength(1);
      expect(sendCalls).toHaveLength(2);
      // Both attempts carry the same presigned URL, so the retry can still
      // fetch the body the first attempt staged.
      const stagedUrls = sendCalls.map(
        (call) =>
          (JSON.parse(call.payload) as { headers: Record<string, string> })
            .headers["X-Payload-S3-URL"],
      );
      expect(stagedUrls[0]).toBe(stagedUrls[1]);
      expect(deleteCalls).toHaveLength(1);
    });
  });
});
