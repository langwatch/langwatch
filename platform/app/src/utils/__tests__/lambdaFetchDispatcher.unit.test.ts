/**
 * Which fetch sends a self-hosted nlpgo call, and what carries the socket
 * timeouts an abort signal cannot raise.
 *
 * undici's `headersTimeout`/`bodyTimeout` (300s each) live on the dispatcher,
 * so a caller whose deadline is longer than that must pass one. The dispatcher
 * only works with the fetch from the same undici package. The global one is
 * bound to the runtime's bundled copy and is rejected up front with
 * "invalid onRequestStart method". Pairing them is lambdaFetch's job, so that
 * no caller can mismatch them; see specs/scenarios/nlp-fetch-transport.feature.
 */
import type { Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { undiciFetchMock } = vi.hoisted(() => ({
  undiciFetchMock: vi.fn(
    async (
      _url: string,
      _init?: {
        method?: string;
        dispatcher?: unknown;
        signal?: AbortSignal;
      },
    ) => new Response("{}", { status: 200 }),
  ),
}));

vi.mock("undici", () => ({ fetch: undiciFetchMock }));

vi.mock("../../env.mjs", () => ({
  env: { EVAL_MAX_PAYLOAD_BYTES: 16_000_000 },
}));

vi.mock("@aws-sdk/client-lambda", () => ({ InvokeCommand: class {} }));

vi.mock("../../optimization_studio/server/lambda", () => ({
  createLambdaClient: vi.fn(),
}));

vi.mock("../../server/s3/stagePayload", () => ({
  STAGED_PAYLOAD_HEADER: "X-Payload-S3-URL",
  stagePayloadToS3: vi.fn(),
  deleteStagedObject: vi.fn(),
}));

// Loaded fresh, under this file's undici mock. Test files share one module
// registry, so a static import can return a lambdaFetch another file already
// evaluated and bound to the real undici fetch, which would send the request
// for real and leave the spy below with no calls.
vi.resetModules();
const { lambdaFetch } = await import("../lambdaFetch");

const URL_TARGET = "http://localhost:5561";
const PATH = "/go/studio/execute_sync";

/** Stands in for `createNlpFetchDispatcher({ timeoutMs })`'s Agent. */
const dispatcher = { _nlpAgent: true } as unknown as Dispatcher;

beforeEach(() => {
  undiciFetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sending a self-hosted nlpgo call", () => {
  describe("given a caller that needs a socket open past undici's 300s default", () => {
    /** @scenario "A dispatcher raises the HTTP lane's own timeouts" */
    it("sends with that dispatcher, through the matching undici fetch", async () => {
      const globalFetch = vi.fn();
      vi.stubGlobal("fetch", globalFetch);

      const response = await lambdaFetch(URL_TARGET, PATH, {
        method: "POST",
        body: "{}",
        dispatcher,
      });

      expect(undiciFetchMock).toHaveBeenCalledTimes(1);
      expect(undiciFetchMock.mock.calls[0]![0]).toBe(URL_TARGET + PATH);
      expect(undiciFetchMock.mock.calls[0]![1]).toMatchObject({
        method: "POST",
        dispatcher,
      });
      expect(globalFetch).not.toHaveBeenCalled();
      expect(response.ok).toBe(true);
    });

    it("carries the caller's deadline on the same request", async () => {
      vi.stubGlobal("fetch", vi.fn());

      await lambdaFetch(URL_TARGET, PATH, {
        method: "POST",
        body: "{}",
        dispatcher,
        timeoutMs: 630_000,
      });

      expect(undiciFetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(
        AbortSignal,
      );
    });
  });

  describe("given a caller that passes no dispatcher", () => {
    /** @scenario "A caller that passes no dispatcher uses the global fetch" */
    it("goes through the global fetch exactly as before", async () => {
      const globalFetch = vi.fn(
        async (_url: string) => new Response("{}", { status: 200 }),
      );
      vi.stubGlobal("fetch", globalFetch);

      await lambdaFetch(URL_TARGET, PATH, { method: "POST", body: "{}" });

      expect(globalFetch).toHaveBeenCalledTimes(1);
      expect(undiciFetchMock).not.toHaveBeenCalled();
    });
  });
});
