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
  status: "healed",
  target: {
    endpoint: `${ENDPOINT}/v1/logs`,
    headers: { Authorization: `Bearer ${FRESH}` },
  },
} as const;

/** The healer decided from the config alone; nothing was attempted. */
const DECLINED = { status: "declined" } as const;
/** The healer went to the platform and did not come back with a wired tool. */
const FAILED = { status: "failed" } as const;
/** The platform said a person revoked the key on purpose. */
const WITHHELD = { status: "withheld" } as const;

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
      const healRevokedKey = vi.fn().mockResolvedValue(DECLINED);

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
      const healRevokedKey = vi.fn().mockResolvedValue(DECLINED);
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
      const healRevokedKey = vi.fn().mockResolvedValue(DECLINED);
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

  describe("given two sessions that start at the same moment", () => {
    /** @scenario "Two sessions rejected at the same moment mint one key" */
    it("lets one of the two reach the healer", async () => {
      // A healer held open across both runs. The window is claimed before the
      // mint, so the second hook finds the first one's claim; were it recorded
      // afterwards, both would read no attempt and both would mint.
      const healRevokedKey = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return DECLINED;
      });

      await Promise.all([
        hook.runHook({
          env: OLD_KEY_ENV,
          fetchImpl: rotatedCollector,
          healRevokedKey,
        }),
        hook.runHook({
          env: OLD_KEY_ENV,
          fetchImpl: rotatedCollector,
          healRevokedKey,
        }),
      ]);

      expect(healRevokedKey).toHaveBeenCalledTimes(1);
    });
  });

  describe("given two sessions that both find the same expired claim", () => {
    /** @scenario "Two sessions taking over the same stale claim mint one key" */
    it("lets one of the two reach the healer", async () => {
      // A claim left by a run that died mid-heal. Replacing it is a delete
      // then a create, so without an exclusive right to do that, the second
      // hook would delete the claim the first one just wrote and both would
      // mint.
      fs.mkdirSync(hook.stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(hook.stateDir, "heal-claude_code.json"),
        JSON.stringify({ attemptedAt: NOW - 11 * 60_000 }),
      );
      const healRevokedKey = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return DECLINED;
      });

      await Promise.all([
        hook.runHook({
          env: OLD_KEY_ENV,
          fetchImpl: rotatedCollector,
          healRevokedKey,
        }),
        hook.runHook({
          env: OLD_KEY_ENV,
          fetchImpl: rotatedCollector,
          healRevokedKey,
        }),
      ]);

      expect(healRevokedKey).toHaveBeenCalledTimes(1);
      // The takeover marker is not left behind to cost the next window.
      expect(
        fs.existsSync(
          path.join(hook.stateDir, "heal-claude_code.json.takeover"),
        ),
      ).toBe(false);
    });

    /** @scenario "A hook that loses the takeover leaves the winner's claim alone" */
    it("stands down while another hook holds the takeover", async () => {
      // The state another hook is in between deleting the stale claim and
      // writing its own. This hook must not delete what that one is about to
      // write, so it stands down on the marker rather than on the claim.
      fs.mkdirSync(hook.stateDir, { recursive: true });
      const claim = path.join(hook.stateDir, "heal-claude_code.json");
      fs.writeFileSync(
        claim,
        JSON.stringify({ attemptedAt: NOW - 11 * 60_000 }),
      );
      fs.writeFileSync(
        `${claim}.takeover`,
        JSON.stringify({ attemptedAt: NOW }),
      );
      const healRevokedKey = vi.fn().mockResolvedValue(DECLINED);

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });

      expect(healRevokedKey).not.toHaveBeenCalled();
      // The claim the winner is mid-way through replacing is still there.
      expect(fs.existsSync(claim)).toBe(true);
    });
  });

  describe("given a 401 on a target that carried no key", () => {
    /** @scenario "A 401 the device sent no key with is not this key's failure" */
    it("hands the healer no rejected token, and stays silent when it declines", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(DECLINED);

      // No OTEL_EXPORTER_OTLP_HEADERS: the target carries an endpoint and no
      // authorization at all, so the 401 is not the cached key's failure.
      await hook.runHook({
        fetchImpl: hook.collector(401),
        healRevokedKey,
      });

      expect(healRevokedKey).toHaveBeenCalledWith({
        agent: "claude_code",
        rejectedToken: undefined,
      });
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    /** @scenario "A decline does not spend the heal throttle" */
    it("does not spend the throttle, so the next repairable 401 still heals", async () => {
      const healRevokedKey = vi
        .fn()
        .mockResolvedValueOnce(DECLINED)
        .mockResolvedValueOnce(HEALED);

      // First session: no bearer to reject, so the healer declines.
      await hook.runHook({
        fetchImpl: hook.collector(401),
        healRevokedKey,
      });
      expect(
        fs.existsSync(path.join(hook.stateDir, "heal-claude_code.json")),
      ).toBe(false);

      // Second session, inside the ten-minute window, now carrying the key the
      // collector rejects. It must still be healed.
      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });

      expect(healRevokedKey).toHaveBeenCalledTimes(2);
      expect(healRevokedKey).toHaveBeenLastCalledWith({
        agent: "claude_code",
        rejectedToken: OLD,
      });
      expect(hook.stdout).toHaveLength(1);
    });
  });

  describe("given a heal that reached the platform and failed", () => {
    /** @scenario "A failed heal spends the throttle" */
    it("spends the throttle, so a mint is not retried every session", async () => {
      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey: vi.fn().mockResolvedValue(FAILED),
      });

      expect(
        fs.existsSync(path.join(hook.stateDir, "heal-claude_code.json")),
      ).toBe(true);
      expect(hook.stdout).toEqual([]);
    });
  });

  describe("given a key the platform says a person revoked", () => {
    /** @scenario "A key a person revoked is not re-minted" */
    it("posts nothing more and tells the user to set the machine up again", async () => {
      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey: vi.fn().mockResolvedValue(WITHHELD),
      });

      expect(posted.map((request) => request.headers.Authorization)).toEqual([
        `Bearer ${OLD}`,
      ]);
      expect(hook.stdout).toHaveLength(1);
      const notice = JSON.parse(hook.stdout[0]!) as { systemMessage: string };
      expect(notice.systemMessage).toContain("revoked");
      expect(notice.systemMessage).toContain("langwatch instrument claude");
      expect(hook.exits).toEqual([]);
    });

    /** @scenario "A withheld heal spends the throttle" */
    it("does not ask the platform again inside the window", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue(WITHHELD);

      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
      });
      await hook.runHook({
        env: OLD_KEY_ENV,
        fetchImpl: rotatedCollector,
        healRevokedKey,
        now: NOW + 60_000,
      });

      expect(healRevokedKey).toHaveBeenCalledTimes(1);
      expect(
        fs.existsSync(path.join(hook.stateDir, "heal-claude_code.json")),
      ).toBe(true);
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
