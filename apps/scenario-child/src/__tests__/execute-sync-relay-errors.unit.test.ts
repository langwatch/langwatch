/**
 * @vitest-environment node
 * Every failure a code turn reports keeps its kind on either route: the adapter reads only `ok`,
 * `status` and the body text, which a relay must not rewrite.
 * @see specs/scenarios/execute-sync-relay.feature
 */
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import type { CodeAgentData } from "@langwatch/scenario-contract";
import type * as Undici from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async (
      _name: string,
      _opts: unknown,
      fn: (span: Record<string, () => void>) => unknown,
    ) =>
      await fn({
        setAttribute: () => undefined,
        setAttributes: () => undefined,
        setStatus: () => undefined,
        recordException: () => undefined,
        end: () => undefined,
      }),
  }),
}));

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(() => ({ headers: {}, traceId: undefined })),
}));

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof Undici>("undici");
  return { ...actual, fetch: mockFetch };
});

import { EXECUTE_SYNC_RELAY_PATH } from "../channels/execute-sync.channel.ts";
import {
  directExecuteSyncTransport,
  relayExecuteSyncTransport,
} from "../channels/http/http.execute-sync.channel.ts";
import {
  HttpSerializedCodeAgentChannel,
  SerializedCodeAgentAdapterError,
} from "../channels/http/http.serialized-code-agent.channel.ts";
import { SerializedAgentChannelRegistry } from "../channels/serialized-agent-channels.registry.ts";
import { guardAgainstGlobalFetch } from "./support/global-fetch-guard.ts";

guardAgainstGlobalFetch();

const NLP = "http://nlp.internal:5561";
const RELAY = "http://langwatch-app.internal:5560";

const config: CodeAgentData = {
  type: "code",
  agentId: "agent_1",
  code: "class Code:\n    def __call__(self, input: str):\n        ...\n",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  secrets: {},
};

const input = {
  threadId: "thread_1",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
} as AgentInput;

/** The two routes, built the way the child builds them. */
const ROUTES = {
  "straight to the engine": () => directExecuteSyncTransport({ nlpServiceUrl: NLP }),
  "through the control plane": () =>
    relayExecuteSyncTransport({ relayBaseUrl: RELAY, projectApiKey: "project-key" }),
};

/** The five failures, as the thing on the other end of the socket does them. */
const FAILURES = {
  "a 200 whose run status is error": () =>
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ status: "error", error: { message: "ZeroDivisionError" } }),
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
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    ),
  "its own deadline passing": () =>
    mockFetch.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        }),
    ),
};

const EXPECTED: Record<keyof typeof FAILURES, { kind: string; source: string }> = {
  "a 200 whose run status is error": { kind: "execution", source: "user_code" },
  "a non-2xx carrying an envelope": { kind: "http", source: "nlp_service" },
  "a 2xx body that is not JSON": { kind: "parse", source: "nlp_service" },
  "a connection that is never made": { kind: "fetch", source: "network" },
  "its own deadline passing": { kind: "timeout", source: "timeout" },
};

const FAILURE_NAMES = Object.keys(FAILURES) as (keyof typeof FAILURES)[];

async function classify(
  transport: ReturnType<(typeof ROUTES)[keyof typeof ROUTES]>,
): Promise<{ kind: string; source: string }> {
  const adapter = HttpSerializedCodeAgentChannel.create({
    config,
    nlpServiceUrl: NLP,
    projectApiKey: "project-key",
    transport,
    // Keeps the deadline case to a few milliseconds: the operator maximum bounds the deadline.
    timeouts: { maxTimeoutMs: 40 },
  });
  try {
    await adapter.call(input);
  } catch (error) {
    if (!(error instanceof SerializedCodeAgentAdapterError)) throw error;
    return { kind: error.kind, source: error.source };
  }
  throw new Error("the turn did not fail");
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])(
  "a code turn routed %s",
  (routeName) => {
    describe.each(FAILURE_NAMES)("when the turn fails with %s", (failureName) => {
      /** @scenario "A failure keeps its kind on the relayed route" */
      it(`reports kind ${EXPECTED[failureName].kind} and source ${EXPECTED[failureName].source}`, async () => {
        FAILURES[failureName]();

        expect(await classify(ROUTES[routeName]())).toEqual(EXPECTED[failureName]);
      });
    });
  },
);

describe("the two routes side by side", () => {
  /** @scenario "A failure keeps its kind on the relayed route" */
  it("classify every failure identically", async () => {
    const overEngine: Record<string, unknown> = {};
    const overControlPlane: Record<string, unknown> = {};

    for (const failureName of FAILURE_NAMES) {
      mockFetch.mockReset();
      FAILURES[failureName]();
      overEngine[failureName] = await classify(ROUTES["straight to the engine"]());
      mockFetch.mockReset();
      FAILURES[failureName]();
      overControlPlane[failureName] = await classify(ROUTES["through the control plane"]());
    }

    expect(overControlPlane).toEqual(overEngine);
    expect(overEngine).toEqual(EXPECTED);
  });
});

describe("the registry building a code turn from its job", () => {
  function build(
    executeSyncRoute?:
      | { mode: "relay"; relayBaseUrl: string }
      | { mode: "direct"; nlpServiceUrl: string },
  ) {
    return SerializedAgentChannelRegistry.create({
      voiceAgents: () => {
        throw new Error("no voice target in this test");
      },
    }).build({
      adapterData: config,
      nlpServiceUrl: NLP,
      nlpInternalSecret: "engine-secret",
      projectApiKey: "project-key",
      ...(executeSyncRoute ? { executeSyncRoute } : {}),
    });
  }

  it("posts to the relay with the project key when the parent chose the relay", async () => {
    FAILURES["a 2xx body that is not JSON"]();

    await expect(build({ mode: "relay", relayBaseUrl: RELAY }).call(input)).rejects.toBeInstanceOf(
      SerializedCodeAgentAdapterError,
    );

    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${RELAY}${EXECUTE_SYNC_RELAY_PATH}`);
    expect(init.headers["X-Auth-Token"]).toBe("project-key");
    expect(JSON.stringify(init.headers)).not.toContain("engine-secret");
  });

  it("posts to the engine the route names when the parent chose direct", async () => {
    FAILURES["a 2xx body that is not JSON"]();

    await expect(
      build({ mode: "direct", nlpServiceUrl: "http://other-engine:5561" }).call(input),
    ).rejects.toBeInstanceOf(SerializedCodeAgentAdapterError);

    expect(mockFetch.mock.calls[0]?.[0]).toMatch(/^http:\/\/other-engine:5561\//);
  });

  /** @scenario "A job queued before the route existed still runs" */
  it("posts to the job's engine URL when the job carries no route", async () => {
    FAILURES["a 2xx body that is not JSON"]();

    await expect(build().call(input)).rejects.toBeInstanceOf(SerializedCodeAgentAdapterError);

    expect(mockFetch.mock.calls[0]?.[0]).toMatch(new RegExp(`^${NLP}/`));
  });
});
