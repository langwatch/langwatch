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
  beforeEach(() => {
    agentOptions.length = 0;
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
});
