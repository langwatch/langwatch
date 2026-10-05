/**
 * The execute_sync POST the child makes for a code or workflow turn: straight to the engine with
 * its secret, or to the control plane with the project key and never the engine's secret.
 * @see specs/scenarios/execute-sync-relay.feature
 */
import type * as Undici from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(() => ({
    headers: { traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01` },
    traceId: "a".repeat(32),
  })),
}));

const mockFetch = vi.hoisted(() => vi.fn());
const agentOptions = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof Undici>("undici");
  return {
    ...actual,
    fetch: mockFetch,
    Agent: class RecordingAgent extends actual.Agent {
      constructor(options?: Record<string, unknown>) {
        agentOptions.push(options ?? {});
        super(options);
      }
    },
  };
});

import {
  EXECUTE_SYNC_ENGINE_PATH,
  EXECUTE_SYNC_RELAY_PATH,
  type ExecuteSyncTransport,
} from "../channels/execute-sync.channel.ts";
import {
  childExecuteSyncTransport,
  directExecuteSyncTransport,
  relayExecuteSyncTransport,
} from "../channels/http/http.execute-sync.channel.ts";
import { HttpNlpFetchChannel } from "../channels/http/http.nlp-fetch.channel.ts";

const NLP = "http://nlp.internal:5561";
const APP = "http://langwatch-app.internal:5560";
const PROJECT_KEY = "project-key-value";
const SECRET = "engine-internal-secret";

function sentHeaders(): Record<string, string> {
  return mockFetch.mock.calls[0]![1].headers as Record<string, string>;
}

async function send({
  transport,
  timeoutMs = 630_000,
}: {
  transport: ExecuteSyncTransport;
  timeoutMs?: number;
}) {
  await transport.post({
    event: { type: "execute_flow" },
    signal: new AbortController().signal,
    timeoutMs,
  });
}

beforeEach(async () => {
  mockFetch.mockReset();
  // Dispatchers are memoized per deadline, so the recording constructor only runs on a cold cache.
  await HttpNlpFetchChannel.create().close();
  agentOptions.length = 0;
  mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
});

afterEach(async () => {
  await HttpNlpFetchChannel.create().close();
});

describe("a turn routed straight to the engine", () => {
  /** @scenario "A direct turn presents the engine's internal secret" */
  it("posts to the engine's own path with the engine's secret", async () => {
    await send({
      transport: directExecuteSyncTransport({ nlpServiceUrl: NLP, nlpInternalSecret: SECRET }),
    });

    expect(mockFetch.mock.calls[0]![0]).toBe(NLP + EXECUTE_SYNC_ENGINE_PATH);
    expect(sentHeaders()["X-LangWatch-NLP-Secret"]).toBe(SECRET);
    expect(sentHeaders()["X-Auth-Token"]).toBeUndefined();
  });

  it("does not double the slash when the engine URL has a trailing one", async () => {
    await send({ transport: directExecuteSyncTransport({ nlpServiceUrl: `${NLP}/` }) });

    expect(mockFetch.mock.calls[0]![0]).toBe(NLP + EXECUTE_SYNC_ENGINE_PATH);
  });
});

describe("a turn routed through the control plane", () => {
  const relay = () => relayExecuteSyncTransport({ relayBaseUrl: APP, projectApiKey: PROJECT_KEY });

  /** @scenario "A relayed turn presents the project's own key" */
  it("posts to the relay path with the project key and not the engine's secret", async () => {
    await send({ transport: relay() });

    expect(mockFetch.mock.calls[0]![0]).toBe(APP + EXECUTE_SYNC_RELAY_PATH);
    expect(sentHeaders()["X-Auth-Token"]).toBe(PROJECT_KEY);
    expect(sentHeaders()["X-LangWatch-NLP-Secret"]).toBeUndefined();
  });

  it("carries the trace context so the control plane's span joins this trace", async () => {
    await send({ transport: relay() });

    expect(sentHeaders().traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("holds the socket for the caller's whole deadline", async () => {
    await send({ transport: relay(), timeoutMs: 631_002 });

    expect(agentOptions[0]).toMatchObject({ headersTimeout: 631_002, bodyTimeout: 631_002 });
  });

  it("sends the event as the request body, unchanged", async () => {
    const event = {
      type: "execute_flow",
      payload: { workflow: { api_key: "k", secrets: { A: "1" } } },
    };
    await relay().post({ event, signal: new AbortController().signal, timeoutMs: 1000 });

    expect(JSON.parse(mockFetch.mock.calls[0]![1].body as string)).toEqual(event);
  });
});

describe("the route the child builds from its job", () => {
  /** @scenario "A relayed turn presents the project's own key" */
  it("relays when the parent named a relay address", async () => {
    await send({
      transport: childExecuteSyncTransport({
        relayBaseUrl: APP,
        nlpServiceUrl: NLP,
        projectApiKey: PROJECT_KEY,
      }),
    });

    expect(mockFetch.mock.calls[0]![0]).toBe(APP + EXECUTE_SYNC_RELAY_PATH);
  });

  /** @scenario "A job queued before the route existed still runs" */
  it("falls back to the engine URL the job already carried", async () => {
    await send({
      transport: childExecuteSyncTransport({
        relayBaseUrl: undefined,
        nlpServiceUrl: NLP,
        nlpInternalSecret: SECRET,
        projectApiKey: PROJECT_KEY,
      }),
    });

    expect(mockFetch.mock.calls[0]![0]).toBe(NLP + EXECUTE_SYNC_ENGINE_PATH);
    expect(sentHeaders()["X-LangWatch-NLP-Secret"]).toBe(SECRET);
  });
});
