/**
 * @vitest-environment node
 * The agent-test turn posts along the route its job names, as a simulation turn does.
 * @see specs/scenarios/execute-sync-relay.feature
 */
import { createLogger } from "@langwatch/observability";
import { AgentTestTurnJobSchema, type ExecuteSyncRoute } from "@langwatch/scenario-contract";
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

import { guardAgainstGlobalFetch } from "../../__tests__/support/global-fetch-guard.ts";
import { EXECUTE_SYNC_RELAY_PATH } from "../../channels/execute-sync.channel.ts";
import { runAgentTestTurn } from "../agent-test-turn.service.ts";
import type { ScenarioChildRuntime } from "../scenario-child-execution.service.ts";

guardAgainstGlobalFetch();

const RELAY = "http://langwatch-app.internal:5560";
const ENGINE = "http://langwatch_nlp:5561";

const runtime: ScenarioChildRuntime = {
  langwatchEndpoint: RELAY,
  langwatchApiKey: "project-key",
  nlpInternalSecret: "engine-secret",
  verbose: false,
  httpPort: { fetch: () => Promise.reject(new Error("no HTTP agent in this test")) },
  logger: createLogger("langwatch:scenarios:agent-test-turn-route:test"),
  voiceAgents: () => {
    throw new Error("no voice target in this test");
  },
  endVoiceCall: () => Promise.resolve(),
};

function codeTurn(executeSyncRoute: ExecuteSyncRoute) {
  return AgentTestTurnJobSchema.parse({
    kind: "agent-test-turn",
    adapterData: {
      type: "code",
      agentId: "agent_code",
      code: "class Code:\n    def __call__(self, input: str):\n        ...\n",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      secrets: {},
    },
    executeSyncRoute,
    message: "ping",
    timeoutMs: 5_000,
    nlpTimeouts: {},
  });
}

/** Where the turn posted and with which headers; the answer itself is not under test. */
async function postOf(executeSyncRoute: ExecuteSyncRoute) {
  await runAgentTestTurn({ job: codeTurn(executeSyncRoute), runtime }).catch(() => undefined);
  const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
  return { url, headers: init.headers };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "<html>not the engine</html>",
  });
});

describe("runAgentTestTurn", () => {
  describe("given a code agent's turn whose job names the relay", () => {
    /** @scenario "The agent-test turn takes the same route as every other turn" */
    it("posts to the relay with the project's own key and not the engine secret", async () => {
      const { url, headers } = await postOf({ mode: "relay", relayBaseUrl: RELAY });

      expect(url).toBe(`${RELAY}${EXECUTE_SYNC_RELAY_PATH}`);
      expect(headers["X-Auth-Token"]).toBe("project-key");
      expect(JSON.stringify(headers)).not.toContain("engine-secret");
    });
  });

  describe("given a code agent's turn whose job names the engine", () => {
    /** @scenario "A self-hosted agent-test turn posts to the engine directly" */
    it("posts straight to the engine the route names", async () => {
      const { url } = await postOf({ mode: "direct", nlpServiceUrl: ENGINE });

      expect(url).toMatch(new RegExp(`^${ENGINE}/`));
    });
  });
});
