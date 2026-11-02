/**
 * The wired-exporter probe (#7958): the CLI cache and the agent's settings file can drift, so
 * the hook probes the agent's own wired target once per session and heals or reports a 401.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ENDPOINT, installHookHarness, type PostedRequest } from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

/** The CLI's own (live) key, seeded through the exporter environment. */
const CLI_KEY = "ik-lw-cli-live-token";
/** The stale key still sitting in the agent's settings file. */
const WIRED_KEY = "ik-lw-wired-stale-token";
const FRESH = "ik-lw-fresh-token";

const WIRED_ENDPOINT = "https://collector.example/api/otel/v1/logs";

const WIRED = { endpoint: WIRED_ENDPOINT, token: WIRED_KEY };

const HEALED = {
  status: "healed",
  target: {
    endpoint: `${ENDPOINT}/v1/logs`,
    headers: { Authorization: `Bearer ${FRESH}` },
  },
} as const;
const WITHHELD = { status: "withheld" } as const;
const DECLINED = { status: "declined" } as const;

const CLI_KEY_ENV = {
  OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${CLI_KEY}`,
};

/** The plain header record the hook posts with, whatever shape `init.headers` arrived in. */
function headersOf(headers: HeadersInit | undefined): Record<string, string> {
  if (headers instanceof Headers || Array.isArray(headers)) {
    return Object.fromEntries(new Headers(headers));
  }
  return headers ?? {};
}

function record(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): PostedRequest {
  return {
    url: String(input),
    headers: headersOf(init?.headers),
    body: JSON.parse(String(init?.body)) as PostedRequest["body"],
  };
}

/** A collector that refuses exactly the stale wired bearer. */
const wiredRejectingCollector = vi.fn<typeof fetch>(async (input, init) => {
  const request = record(input, init);
  posted.push(request);
  const status = request.headers.Authorization === `Bearer ${WIRED_KEY}` ? 401 : 200;
  return new Response("{}", { status });
});

describe("the wired-exporter probe", () => {
  describe("given an agent whose settings file holds a key the collector refuses", () => {
    /** @scenario "A drifted wired key is probed and healed" */
    it("probes the wired target once and heals against the wired token, not the cached one", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(HEALED);

      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: wiredRejectingCollector,
        readWiredTarget: () => WIRED,
        healRevokedKey,
      });

      const probe = posted.find((r) => r.url === WIRED_ENDPOINT);
      expect(probe?.headers.Authorization).toBe(`Bearer ${WIRED_KEY}`);
      expect(probe?.body).toEqual({ resourceLogs: [] });

      expect(healRevokedKey).toHaveBeenCalledWith({
        sourceType: "claude_code",
        rejectedToken: WIRED_KEY,
        rejectedTokenSource: "wiring",
      });

      expect(hook.stdout.length).toBe(1);
      expect(JSON.parse(hook.stdout[0]!)).toEqual({
        systemMessage: expect.stringContaining("restart Claude Code"),
      });
      expect(hook.exits).toEqual([]);
    });

    /** @scenario "A refused wiring nobody can re-mint is reported plainly" */
    it("names the refusing endpoint when the heal is withheld", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(WITHHELD);

      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: wiredRejectingCollector,
        readWiredTarget: () => WIRED,
        healRevokedKey,
      });

      expect(JSON.parse(hook.stdout[0]!)).toEqual({
        systemMessage: expect.stringContaining(`refused by ${WIRED_ENDPOINT}`),
      });
      expect(JSON.parse(hook.stdout[0]!)).toEqual({
        systemMessage: expect.stringContaining("langwatch instrument claude"),
      });
    });

    /** @scenario "A drifted wired key is probed and healed" */
    it("asks only once per session, however many hooks fire", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(DECLINED);

      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: wiredRejectingCollector,
        readWiredTarget: () => WIRED,
        healRevokedKey,
      });
      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: wiredRejectingCollector,
        readWiredTarget: () => WIRED,
        healRevokedKey,
      });

      expect(posted.filter((r) => r.url === WIRED_ENDPOINT)).toHaveLength(1);
    });
  });

  describe("given wiring that matches the target the hook already posted with", () => {
    /** @scenario "A wiring that matches the hook's own target is not probed" */
    it("sends no probe — the record itself already asked", async () => {
      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: hook.collector(200),
        readWiredTarget: () => ({ endpoint: `${ENDPOINT}/v1/logs`, token: CLI_KEY }),
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]?.body).not.toEqual({ resourceLogs: [] });
    });
  });

  describe("given a machine with no wiring at all", () => {
    it("stays silent and costs one lookup", async () => {
      const readWiredTarget = vi.fn(() => null);
      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: hook.collector(200),
        readWiredTarget,
      });

      expect(readWiredTarget).toHaveBeenCalledOnce();
      expect(posted).toHaveLength(1);
      expect(hook.stdout).toEqual([]);
    });
  });

  describe("given a codex session with drifted wiring", () => {
    /** @scenario "Only Claude Code's wiring is probed" */
    it("probes nothing, since codex has no channel to report the outcome on", async () => {
      const readWiredTarget = vi.fn(() => WIRED);
      const healRevokedKey = vi.fn().mockResolvedValue(HEALED);
      await hook.runHook({
        tool: "codex",
        env: CLI_KEY_ENV,
        fetchImpl: wiredRejectingCollector,
        readWiredTarget,
        healRevokedKey,
      });

      expect(readWiredTarget).not.toHaveBeenCalled();
      expect(posted.filter((r) => r.url === WIRED_ENDPOINT)).toEqual([]);
      expect(healRevokedKey).not.toHaveBeenCalled();
    });
  });

  describe("given a probe the network never answered", () => {
    /** @scenario "An offline probe does not spend the session's one ask" */
    it("releases the session's one ask so the next hook retries", async () => {
      let calls = 0;
      const flaky = vi.fn<typeof fetch>(async (input, init) => {
        const request = record(input, init);
        if (request.url === WIRED_ENDPOINT) {
          calls += 1;
          if (calls === 1) throw new Error("ECONNREFUSED");
        }
        posted.push(request);
        return new Response("{}", { status: 200 });
      });

      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: flaky,
        readWiredTarget: () => WIRED,
      });
      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: flaky,
        readWiredTarget: () => WIRED,
      });

      // The offline first ask spent nothing; the second hook probed again.
      expect(calls).toBe(2);
      expect(posted.filter((r) => r.url === WIRED_ENDPOINT)).toHaveLength(1);
    });
  });
});
