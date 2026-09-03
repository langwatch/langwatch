/**
 * The daemon runs concurrent requests in one process; device-mode requests
 * carry no caller API key, so the resolved per-user key must NOT live in the
 * shared `process.env` where an interleaved request could read it. It lives in
 * a per-request holder scope instead. These tests pin the two properties the
 * fix depends on:
 *
 *   1. two interleaved holder scopes each observe only their own credential,
 *      even when the key is set AFTER an await inside the scope (exactly how
 *      the resolver fills it mid-command): the isolation the daemon requires,
 *      and
 *   2. the API-client factory reads the scoped key, with no scope falling back
 *      to the environment exactly as a plain SDK embed does.
 *
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The real openapi-fetch client keeps its header config private, so capture
// what the factory hands it: the Authorization the transport would send is
// exactly what these tests need to observe.
const createClientCalls = vi.hoisted(() => [] as Array<{ headers?: Record<string, string> }>);
vi.mock("openapi-fetch", () => ({
  default: (config: { headers?: Record<string, string> }) => {
    createClientCalls.push(config);
    return { use: () => undefined };
  },
}));

import { createLangWatchApiClient } from "../api/client";
import {
  resetFallbackCredentialHolder,
  runWithCredentialHolder,
  scopedApiKey,
  setResolvedApiKey,
} from "../credentialContext";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("credentialContext", () => {
  afterEach(() => {
    resetFallbackCredentialHolder();
    vi.restoreAllMocks();
  });

  /** @scenario two interleaved requests each observe only their own credential */
  it("isolates two concurrent holder scopes whose keys are set after an await", async () => {
    const seen: string[] = [];

    // Each scope resolves its key AFTER an await, mimicking a command that
    // awaits resolveCredentials() and only then knows its identity.
    const requestA = runWithCredentialHolder(async () => {
      await tick();
      setResolvedApiKey("key-A");
      await tick();
      seen.push(`A:${scopedApiKey()}`);
      return scopedApiKey();
    });
    const requestB = runWithCredentialHolder(async () => {
      await tick();
      setResolvedApiKey("key-B");
      await tick();
      seen.push(`B:${scopedApiKey()}`);
      return scopedApiKey();
    });

    const [a, b] = await Promise.all([requestA, requestB]);

    expect(a).toBe("key-A");
    expect(b).toBe("key-B");
    expect(seen.sort()).toEqual(["A:key-A", "B:key-B"]);
  });

  it("a key set mid-scope is visible to the code that runs afterward", async () => {
    await runWithCredentialHolder(async () => {
      expect(scopedApiKey()).toBeUndefined();
      await tick();
      setResolvedApiKey("entered");
      await tick();
      expect(scopedApiKey()).toBe("entered");
    });
  });

  it("returns undefined outside any scope, so the factory falls back to env", () => {
    const savedEnvKey = process.env.LANGWATCH_API_KEY;
    process.env.LANGWATCH_API_KEY = "env-key";
    try {
      expect(scopedApiKey()).toBeUndefined();

      // A plain SDK embed sets no scope: the REAL factory's headers must
      // carry the environment key, the unchanged pre-daemon behavior.
      createClientCalls.length = 0;
      createLangWatchApiClient();
      expect(createClientCalls[0]?.headers?.authorization).toBe("Bearer env-key");
    } finally {
      if (savedEnvKey === undefined) delete process.env.LANGWATCH_API_KEY;
      else process.env.LANGWATCH_API_KEY = savedEnvKey;
    }
  });

  it("the API-client factory sends the scoped key, never a leaked env key", async () => {
    const savedEnvKey = process.env.LANGWATCH_API_KEY;
    process.env.LANGWATCH_API_KEY = "env-leak";
    try {
      // The REAL factory, no arguments, called inside a holder scope: the
      // Authorization it hands the transport proves which key its default
      // selected. A regression to plain env reads would surface here.
      createClientCalls.length = 0;
      await runWithCredentialHolder(async () => {
        setResolvedApiKey("scoped-key");
        createLangWatchApiClient();
      });

      const config = createClientCalls[0];
      expect(config?.headers?.authorization).toBe("Bearer scoped-key");
      expect(JSON.stringify(config)).not.toContain("env-leak");

      // The factory reads the shared environment, never writes it.
      expect(process.env.LANGWATCH_API_KEY).toBe("env-leak");
    } finally {
      if (savedEnvKey === undefined) delete process.env.LANGWATCH_API_KEY;
      else process.env.LANGWATCH_API_KEY = savedEnvKey;
    }
  });
});
