/**
 * @vitest-environment node
 *
 * Every failure a code turn can report, classified the same way whichever
 * route the turn took.
 *
 * The adapter decides between a failed run, a rejected request, a malformed
 * answer, an unreachable service and its own deadline from three values: `ok`,
 * `status`, and the body as text. Relaying through the control plane changes
 * where those come from, so this suite drives the SAME five failures over both
 * routes and asserts the classification is identical. A relay that rewrote a
 * status or a body would collapse these into one another, and a customer whose
 * Python raised would be told their engine is down.
 */
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardAgainstGlobalFetch } from "../../../../../test-utils/globalFetchGuard";
import { closeNlpFetchDispatchers } from "../../../../nlpgo/timeouts";
import type { CodeAgentData } from "../../types";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: () => void }) => unknown,
    ) => await fn({ setAttribute: () => undefined }),
  }),
}));

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(() => ({ headers: {}, traceId: undefined })),
}));

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return { ...actual, fetch: mockFetch };
});

guardAgainstGlobalFetch();

import {
  SerializedCodeAgentAdapter,
  type SerializedCodeAgentAdapterError,
} from "../code-agent.adapter";
import {
  directExecuteSyncTransport,
  relayExecuteSyncTransport,
} from "../execute-sync-transport";

const config: CodeAgentData = {
  type: "code",
  agentId: "agent_1",
  code: "class Code:\n    def __call__(self, input: str):\n        ...\n",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  secrets: {},
};

const input: AgentInput = {
  threadId: "thread_1",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
} as AgentInput;

/** The two routes, built the way the child builds them. */
const ROUTES = {
  "straight to the engine": () =>
    directExecuteSyncTransport({ nlpServiceUrl: "http://nlp.internal:5561" }),
  "through the control plane": () =>
    relayExecuteSyncTransport({
      relayBaseUrl: "https://app.langwatch.ai",
      projectApiKey: "project-key",
    }),
};

/** The five failures, as the thing on the other end of the socket does them. */
const FAILURES = {
  "a 200 whose run status is error": () =>
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: "error",
          error: { message: "ZeroDivisionError", traceback: "line 3" },
        }),
    }),
  "a non-2xx carrying an envelope": () =>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: { message: "engine down" } }),
    }),
  "a 2xx body that is not JSON": () =>
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>a proxy answered</html>",
    }),
  "a connection that is never made": () =>
    mockFetch.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    ),
  "its own deadline passing": () =>
    mockFetch.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            { once: true },
          );
        }),
    ),
};

const EXPECTED: Record<
  keyof typeof FAILURES,
  { kind: string; source: string }
> = {
  "a 200 whose run status is error": {
    kind: "execution",
    source: "user_code",
  },
  "a non-2xx carrying an envelope": { kind: "http", source: "nlp_service" },
  "a 2xx body that is not JSON": { kind: "parse", source: "nlp_service" },
  "a connection that is never made": { kind: "fetch", source: "network" },
  "its own deadline passing": { kind: "timeout", source: "timeout" },
};

async function classify(
  transport: ReturnType<(typeof ROUTES)[keyof typeof ROUTES]>,
): Promise<{ kind: string; source: string }> {
  const adapter = new SerializedCodeAgentAdapter({
    config,
    transport,
    projectApiKey: "project-key",
  });
  try {
    await adapter.call(input);
  } catch (error) {
    const failure = error as SerializedCodeAgentAdapterError;
    return { kind: failure.kind, source: failure.source };
  }
  throw new Error("the turn did not fail");
}

beforeEach(async () => {
  mockFetch.mockReset();
  await closeNlpFetchDispatchers();
  // Keeps the deadline case to a few milliseconds: the adapter's deadline is
  // the engine's ceiling plus headroom, bounded by this operator maximum.
  vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "40");
});

// The unit config runs with `isolate: false`, so a stub left in place puts
// every later file in this worker on a 40ms deadline.
afterEach(async () => {
  vi.unstubAllEnvs();
  await closeNlpFetchDispatchers();
});

describe.each(
  Object.keys(ROUTES) as (keyof typeof ROUTES)[],
)("a code turn routed %s", (routeName) => {
  for (const failureName of Object.keys(
    FAILURES,
  ) as (keyof typeof FAILURES)[]) {
    describe(`when the turn fails with ${failureName}`, () => {
      /** @scenario "A failure keeps its kind on the relayed route" */
      it(`reports kind ${EXPECTED[failureName].kind} and source ${EXPECTED[failureName].source}`, async () => {
        FAILURES[failureName]();

        expect(await classify(ROUTES[routeName]())).toEqual(
          EXPECTED[failureName],
        );
      });
    });
  }
});

describe("the two routes side by side", () => {
  /** @scenario "A failure keeps its kind on the relayed route" */
  it("classify every failure identically", async () => {
    const overEngine: Record<string, unknown> = {};
    const overControlPlane: Record<string, unknown> = {};

    for (const failureName of Object.keys(
      FAILURES,
    ) as (keyof typeof FAILURES)[]) {
      mockFetch.mockReset();
      FAILURES[failureName]();
      overEngine[failureName] = await classify(
        ROUTES["straight to the engine"](),
      );
      mockFetch.mockReset();
      FAILURES[failureName]();
      overControlPlane[failureName] = await classify(
        ROUTES["through the control plane"](),
      );
    }

    expect(overControlPlane).toEqual(overEngine);
    expect(overEngine).toEqual(EXPECTED);
  });
});
