/**
 * The wired-exporter probe: the hook asking whether the AGENT's own key can
 * still be heard, not just its own (#7958).
 *
 * The CLI's cache and the agent's settings file can drift. When they do, the
 * hook posts with a live key and succeeds while every span the agent emits
 * 401s in silence — the exact failure where two days of work produced zero
 * events. The probe posts one empty batch per session to the target read out
 * of the agent's own wiring, and a 401 there heals or reports.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  ENDPOINT,
  installHookHarness,
  type PostedRequest,
} from "./hook-harness";

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

/** A collector that refuses exactly the stale wired bearer. */
const wiredRejectingCollector: typeof fetch = ((
  url: string,
  init: { headers: Record<string, string>; body: string },
) => {
  posted.push({
    url,
    headers: init.headers,
    body: JSON.parse(init.body) as PostedRequest["body"],
  });
  const status =
    init.headers.Authorization === `Bearer ${WIRED_KEY}` ? 401 : 200;
  return Promise.resolve(new Response("{}", { status }));
}) as unknown as typeof fetch;

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
        agent: "claude_code",
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
        systemMessage: expect.stringContaining(
          `refused by ${WIRED_ENDPOINT}`,
        ),
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
      await hook.runHook({
        env: CLI_KEY_ENV,
        fetchImpl: hook.collector(200),
        readWiredTarget: () => null,
      });

      expect(posted).toHaveLength(1);
      expect(hook.stdout).toEqual([]);
    });
  });

  describe("given a probe the network never answered", () => {
    /** @scenario "An offline probe does not spend the session's one ask" */
    it("releases the session's one ask so the next hook retries", async () => {
      let calls = 0;
      const flaky: typeof fetch = ((url: string, init: { headers: Record<string, string>; body: string }) => {
        if (url === WIRED_ENDPOINT) {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error("ECONNREFUSED"));
        }
        posted.push({
          url,
          headers: init.headers,
          body: JSON.parse(init.body) as PostedRequest["body"],
        });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch;

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
