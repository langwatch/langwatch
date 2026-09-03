/**
 * What the session context hook does when the collector rejects its key: the
 * one path where the hook repairs the device rather than staying silent.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ENDPOINT,
  installHookHarness,
  NOW,
  type PostedRequest,
  SESSION_ID,
} from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

const OLD = "ik-lw-old-token";
const FRESH = "ik-lw-fresh-token";
const HEALED = {
  endpoint: `${ENDPOINT}/v1/logs`,
  headers: { Authorization: `Bearer ${FRESH}` },
};

/** A collector that rejects the old bearer and accepts the fresh one. */
const rotatedCollector: typeof fetch = ((
  url: string,
  init: { headers: Record<string, string>; body: string },
) => {
  posted.push({
    url,
    headers: init.headers,
    body: JSON.parse(init.body) as PostedRequest["body"],
  });
  const status = init.headers.Authorization === `Bearer ${FRESH}` ? 200 : 401;
  return Promise.resolve(new Response("{}", { status }));
}) as unknown as typeof fetch;

const OLD_KEY_ENV = { OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${OLD}` };

describe("the session context hook's self-heal", () => {
  describe("given a signed-in CLI whose cached key the collector rejects", () => {
    /** @scenario "A rejected personal key is re-minted, rewired and retried" */
    it("re-mints, retries the record with the new key and tells the user to restart", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(HEALED);

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });

      expect(healRevokedKey).toHaveBeenCalledWith({
        agent: "claude_code",
        rejectedToken: OLD,
      });
      expect(posted.map((request) => request.headers.Authorization)).toEqual([
        `Bearer ${OLD}`,
        `Bearer ${FRESH}`,
      ]);
      expect(hook.stdout).toHaveLength(1);
      expect(JSON.parse(hook.stdout[0]!)).toEqual({
        systemMessage: expect.stringContaining("restart Claude Code"),
      });
      expect(hook.exits).toEqual([]);
      // The retry landed, so the context counts as reported.
      const fingerprints = fs
        .readdirSync(hook.stateDir)
        .filter((name) => name.includes(SESSION_ID));
      expect(fingerprints).toHaveLength(1);
    });
  });

  describe("given a rejected key the healer cannot repair", () => {
    /** @scenario "A rejected key with no login to mint with stays silent" */
    it("posts once, writes nothing and exits zero", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(null);

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });

      expect(healRevokedKey).toHaveBeenCalledTimes(1);
      expect(posted).toHaveLength(1);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    it("stays silent when the healer itself fails", async () => {
      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey: vi.fn().mockRejectedValue(new Error("mint failed")),
      });

      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });

  describe("given a heal attempted minutes ago", () => {
    /** @scenario "A second rejection inside the throttle window does not re-mint" */
    it("does not ask the healer again inside the throttle window", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(null);
      fs.mkdirSync(hook.stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(hook.stateDir, "heal-claude_code.json"),
        JSON.stringify({ attemptedAt: NOW - 60_000 }),
      );

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });

      expect(healRevokedKey).not.toHaveBeenCalled();
    });

    it("asks again once the window has passed", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(null);
      fs.mkdirSync(hook.stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(hook.stateDir, "heal-claude_code.json"),
        JSON.stringify({ attemptedAt: NOW - 11 * 60_000 }),
      );

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });

      expect(healRevokedKey).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a collector that fails for another reason", () => {
    it("does not treat a 500 as a dead key", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(HEALED);

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: hook.collector(500),
        healRevokedKey,
      });

      expect(healRevokedKey).not.toHaveBeenCalled();
      expect(hook.stdout).toEqual([]);
    });
  });
});
