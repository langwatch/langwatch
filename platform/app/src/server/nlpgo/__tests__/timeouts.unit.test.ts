import { Agent } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Undici's Agent does not read back the timeouts it was constructed with, so
// the only way to assert on them is to record the constructor's arguments.
const agentOptions = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return {
    ...actual,
    Agent: class RecordingAgent extends actual.Agent {
      constructor(opts?: Record<string, unknown>) {
        agentOptions.push(opts ?? {});
        super(opts);
      }
    },
  };
});

import {
  closeNlpFetchDispatchers,
  createNlpFetchDispatcher,
  NLP_FETCH_HEADROOM_MS,
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV,
  resolveFloorFetchTimeoutMs,
} from "../timeouts";

const DEFAULT_FLOOR_MS =
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS * 1000 +
  NLP_FETCH_HEADROOM_MS;

describe("resolveFloorFetchTimeoutMs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives the floor from the operator's ceiling", () => {
    vi.stubEnv(NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV, "300");
    expect(resolveFloorFetchTimeoutMs()).toBe(
      300 * 1000 + NLP_FETCH_HEADROOM_MS,
    );
  });

  it("falls back to the engine's own default when the variable is unset", () => {
    vi.stubEnv(NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV, undefined);
    expect(resolveFloorFetchTimeoutMs()).toBe(DEFAULT_FLOOR_MS);
  });

  // The engine and the Lambda clamp both take whole seconds only. Honouring a
  // fraction here made this the permissive reader of a variable the other two
  // reject: "0.5" left the engine on its 600s ceiling while this side derived
  // a 30.5s deadline and cut the socket on every turn.
  describe.each([
    "0.5",
    "1.5",
    "700.5",
  ])("a fractional %s is not a whole number of seconds", (raw) => {
    it("falls back to the engine's default rather than shortening the deadline", () => {
      vi.stubEnv(NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV, raw);
      expect(resolveFloorFetchTimeoutMs()).toBe(DEFAULT_FLOOR_MS);
    });
  });

  it.each([
    "",
    "   ",
    "abc",
    "0",
    "-1",
    "NaN",
    "Infinity",
  ])("falls back on the unusable value %p", (raw) => {
    vi.stubEnv(NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV, raw);
    expect(resolveFloorFetchTimeoutMs()).toBe(DEFAULT_FLOOR_MS);
  });
});

describe("createNlpFetchDispatcher", () => {
  // Dispatchers are memoized module-wide (see timeouts.ts), so each test
  // must start from an empty cache or it would silently observe a dispatcher
  // built - and recorded into agentOptions - by a previous test.
  beforeEach(async () => {
    agentOptions.length = 0;
    await closeNlpFetchDispatchers();
  });

  it("sizes undici's own headers and body timeouts to the caller's deadline", () => {
    createNlpFetchDispatcher({ timeoutMs: 500_000 });

    expect(agentOptions.at(-1)?.headersTimeout).toBe(500_000);
    expect(agentOptions.at(-1)?.bodyTimeout).toBe(500_000);
  });

  it("returns an undici dispatcher", () => {
    expect(createNlpFetchDispatcher({ timeoutMs: 500_000 })).toBeInstanceOf(
      Agent,
    );
  });

  it("memoizes: the same timeoutMs returns the same dispatcher instance", () => {
    const first = createNlpFetchDispatcher({ timeoutMs: 42_000 });
    const second = createNlpFetchDispatcher({ timeoutMs: 42_000 });

    expect(second).toBe(first);
    // Only the first call should have constructed a new Agent.
    expect(agentOptions).toHaveLength(1);
  });

  it("does not memoize across different timeoutMs values", () => {
    const first = createNlpFetchDispatcher({ timeoutMs: 10_000 });
    const second = createNlpFetchDispatcher({ timeoutMs: 20_000 });

    expect(second).not.toBe(first);
    expect(agentOptions).toHaveLength(2);
  });

  it("a memoized dispatcher still carries headersTimeout/bodyTimeout equal to timeoutMs", () => {
    createNlpFetchDispatcher({ timeoutMs: 77_000 });
    createNlpFetchDispatcher({ timeoutMs: 77_000 }); // served from cache

    expect(agentOptions.at(-1)?.headersTimeout).toBe(77_000);
    expect(agentOptions.at(-1)?.bodyTimeout).toBe(77_000);
  });
});

describe("closeNlpFetchDispatchers", () => {
  beforeEach(async () => {
    agentOptions.length = 0;
    await closeNlpFetchDispatchers();
  });

  it("empties the cache so a later call constructs a fresh instance", async () => {
    const first = createNlpFetchDispatcher({ timeoutMs: 99_000 });

    await closeNlpFetchDispatchers();
    const second = createNlpFetchDispatcher({ timeoutMs: 99_000 });

    expect(second).not.toBe(first);
    expect(agentOptions).toHaveLength(2);
  });
});
