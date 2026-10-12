/**
 * @vitest-environment node
 *
 * Where a code or workflow turn goes, and which credential it carries.
 *
 * Two routes, and the child must present the right credential to each: the
 * engine authenticates the internal secret, the control plane authenticates
 * the project key, and sending either to the wrong one is a 401 on every turn.
 *
 * The dispatcher is asserted on both routes. undici's own
 * headersTimeout/bodyTimeout live on it, not on the request, so a route that
 * forgot it would be cut off at undici's 300s default however far out the
 * deadline is armed, which is a bug that has reached production once already
 * (see specs/scenarios/nlp-fetch-transport.feature).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardAgainstGlobalFetch } from "../../../../../test-utils/globalFetchGuard";
import { NLP_INTERNAL_SECRET_ENV } from "../../../../nlpgo/internalSecret";
import { closeNlpFetchDispatchers } from "../../../../nlpgo/timeouts";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(() => ({
    headers: {
      traceparent: "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01",
    },
    traceId: "a".repeat(32),
  })),
}));

const mockFetch = vi.hoisted(() => vi.fn());
const agentOptions = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return {
    ...actual,
    fetch: mockFetch,
    Agent: class RecordingAgent extends actual.Agent {
      constructor(opts?: Record<string, unknown>) {
        agentOptions.push(opts ?? {});
        super(opts);
      }
    },
  };
});

// A regression back to the global fetch must not pass this suite: that pairing
// is rejected by undici up front and failed every agent call in production.
guardAgainstGlobalFetch();

import {
  childExecuteSyncTransport,
  directExecuteSyncTransport,
  EXECUTE_SYNC_ENGINE_PATH,
  EXECUTE_SYNC_RELAY_PATH,
  relayExecuteSyncTransport,
} from "../execute-sync-transport";

const NLP = "http://nlp.internal:5561";
const APP = "https://app.langwatch.ai";
const PROJECT_KEY = "project-key-value";
const SECRET = "engine-internal-secret";

function sentHeaders(): Record<string, string> {
  return mockFetch.mock.calls[0]![1].headers as Record<string, string>;
}

async function send(
  transport: { post: (o: any) => Promise<unknown> },
  timeoutMs = 630_000,
) {
  await transport.post({
    event: { type: "execute_flow" },
    signal: new AbortController().signal,
    timeoutMs,
  });
}

beforeEach(async () => {
  mockFetch.mockReset();
  // Dispatchers are memoized by deadline for the process's life, so a value
  // another test file already used would be served from the cache and the
  // recording constructor below would never run. Clearing the cache is what
  // makes the assertion about the dispatcher depend on this transport.
  await closeNlpFetchDispatchers();
  agentOptions.length = 0;
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "{}",
  });
  vi.stubEnv(NLP_INTERNAL_SECRET_ENV, SECRET);
});

// The unit config runs with `isolate: false`, so a stub left in place is a
// stub every later file in this worker reads.
afterEach(async () => {
  vi.unstubAllEnvs();
  await closeNlpFetchDispatchers();
});

describe("a turn routed straight to the engine", () => {
  /** @scenario "A direct turn presents the engine's internal secret" */
  it("posts to the engine's own path with the engine's secret", async () => {
    await send(directExecuteSyncTransport({ nlpServiceUrl: NLP }));

    expect(mockFetch.mock.calls[0]![0]).toBe(NLP + EXECUTE_SYNC_ENGINE_PATH);
    expect(sentHeaders()["X-LangWatch-NLP-Secret"]).toBe(SECRET);
    expect(sentHeaders()["X-Auth-Token"]).toBeUndefined();
  });

  it("holds the socket for the caller's whole deadline", async () => {
    await send(directExecuteSyncTransport({ nlpServiceUrl: NLP }), 631_001);

    expect(agentOptions[0]).toMatchObject({
      headersTimeout: 631_001,
      bodyTimeout: 631_001,
    });
  });

  it("does not double the slash when the engine URL has a trailing one", async () => {
    await send(directExecuteSyncTransport({ nlpServiceUrl: NLP + "/" }));

    expect(mockFetch.mock.calls[0]![0]).toBe(NLP + EXECUTE_SYNC_ENGINE_PATH);
  });
});

describe("a turn routed through the control plane", () => {
  /** @scenario "A relayed turn presents the project's own key" */
  it("posts to the relay path with the project key and not the engine's secret", async () => {
    await send(
      relayExecuteSyncTransport({
        relayBaseUrl: APP,
        projectApiKey: PROJECT_KEY,
      }),
    );

    expect(mockFetch.mock.calls[0]![0]).toBe(APP + EXECUTE_SYNC_RELAY_PATH);
    expect(sentHeaders()["X-Auth-Token"]).toBe(PROJECT_KEY);
    expect(sentHeaders()["X-LangWatch-NLP-Secret"]).toBeUndefined();
  });

  it("carries the trace context so the control plane's span joins this trace", async () => {
    await send(
      relayExecuteSyncTransport({
        relayBaseUrl: APP,
        projectApiKey: PROJECT_KEY,
      }),
    );

    expect(sentHeaders().traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );
  });

  it("holds the socket for the caller's whole deadline", async () => {
    await send(
      relayExecuteSyncTransport({
        relayBaseUrl: APP,
        projectApiKey: PROJECT_KEY,
      }),
      631_002,
    );

    expect(agentOptions[0]).toMatchObject({
      headersTimeout: 631_002,
      bodyTimeout: 631_002,
    });
  });

  it("sends the event as the request body, unchanged", async () => {
    const event = {
      type: "execute_flow",
      payload: {
        workflow: { api_key: "k", secrets: { A: "1" }, params: { p: 2 } },
      },
    };
    await relayExecuteSyncTransport({
      relayBaseUrl: APP,
      projectApiKey: PROJECT_KEY,
    }).post({ event, signal: new AbortController().signal, timeoutMs: 1000 });

    expect(JSON.parse(mockFetch.mock.calls[0]![1].body as string)).toEqual(
      event,
    );
  });
});

describe("the route the child builds from its job", () => {
  /** @scenario "A relayed turn presents the project's own key" */
  it("relays when the parent said to", async () => {
    await send(
      childExecuteSyncTransport({
        route: { mode: "relay", relayBaseUrl: APP },
        nlpServiceUrl: NLP,
        projectApiKey: PROJECT_KEY,
      }),
    );

    expect(mockFetch.mock.calls[0]![0]).toBe(APP + EXECUTE_SYNC_RELAY_PATH);
  });

  it("posts to the engine named on the route when the parent said direct", async () => {
    await send(
      childExecuteSyncTransport({
        route: { mode: "direct", nlpServiceUrl: "http://other:5561" },
        nlpServiceUrl: NLP,
        projectApiKey: PROJECT_KEY,
      }),
    );

    expect(mockFetch.mock.calls[0]![0]).toBe(
      "http://other:5561" + EXECUTE_SYNC_ENGINE_PATH,
    );
  });

  /** @scenario "A job queued before the route existed still runs" */
  it("falls back to the engine URL the job already carried", async () => {
    await send(
      childExecuteSyncTransport({
        route: undefined,
        nlpServiceUrl: NLP,
        projectApiKey: PROJECT_KEY,
      }),
    );

    expect(mockFetch.mock.calls[0]![0]).toBe(NLP + EXECUTE_SYNC_ENGINE_PATH);
    expect(sentHeaders()["X-LangWatch-NLP-Secret"]).toBe(SECRET);
  });
});
