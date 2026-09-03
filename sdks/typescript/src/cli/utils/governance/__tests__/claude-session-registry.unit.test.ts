/**
 * Reading the name claude itself holds for a session out of its live session
 * registry — the piece that makes a mid-session /rename observable from the
 * next hook.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultClaudeSessionRegistryDir, readClaudeSessionName } from "../claude-session-registry";

const SESSION = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";

let registryDir: string;

beforeEach(() => {
  registryDir = mkdtempSync(join(tmpdir(), "lw-claude-registry-"));
});

afterEach(() => {
  rmSync(registryDir, { recursive: true, force: true });
});

const entry = (over: Record<string, unknown> = {}) => ({
  pid: 83315,
  sessionId: SESSION,
  name: "probe-name-test",
  updatedAt: 1,
  ...over,
});

describe("the claude session registry", () => {
  describe("given a registry entry for the session", () => {
    it("answers the session's current name", () => {
      writeFileSync(join(registryDir, "83315.json"), JSON.stringify(entry()));

      expect(readClaudeSessionName({ sessionId: SESSION, registryDir })).toBe("probe-name-test");
    });

    /** @scenario "A mid-session rename reaches the next hook through the registry" */
    it("prefers the newest entry when several claim the session", () => {
      writeFileSync(
        join(registryDir, "83000.json"),
        JSON.stringify(entry({ pid: 83000, name: "stale", updatedAt: 1 })),
      );
      writeFileSync(
        join(registryDir, "83315.json"),
        JSON.stringify(entry({ name: "lw-renamed-probe", updatedAt: 2 })),
      );

      expect(readClaudeSessionName({ sessionId: SESSION, registryDir })).toBe("lw-renamed-probe");
    });
  });

  describe("given nothing usable", () => {
    it("answers null for a session the registry does not know", () => {
      writeFileSync(
        join(registryDir, "83315.json"),
        JSON.stringify(entry({ sessionId: "someone-else" })),
      );

      expect(readClaudeSessionName({ sessionId: SESSION, registryDir })).toBeNull();
    });

    it("answers null on a missing directory", () => {
      expect(
        readClaudeSessionName({
          sessionId: SESSION,
          registryDir: join(registryDir, "not-there"),
        }),
      ).toBeNull();
    });

    it("skips files that are not registry entries", () => {
      writeFileSync(join(registryDir, "broken.json"), "{not json");
      writeFileSync(join(registryDir, "listy.json"), "[1,2,3]");
      mkdirSync(join(registryDir, "subdir.json"));
      writeFileSync(join(registryDir, "83315.json"), JSON.stringify(entry()));

      expect(readClaudeSessionName({ sessionId: SESSION, registryDir })).toBe("probe-name-test");
    });
  });

  describe("when resolving the default location", () => {
    it("honours CLAUDE_CONFIG_DIR over the home directory", () => {
      expect(defaultClaudeSessionRegistryDir({ CLAUDE_CONFIG_DIR: "/etc/claude" })).toBe(
        join("/etc/claude", "sessions"),
      );
      expect(defaultClaudeSessionRegistryDir({})).toBe(join(homedir(), ".claude", "sessions"));
    });

    it("falls back to the home directory when the variable is blank", () => {
      // A variable set to whitespace names no directory. Reading it as one
      // would root the registry at the filesystem root.
      for (const CLAUDE_CONFIG_DIR of ["", "   "]) {
        expect(defaultClaudeSessionRegistryDir({ CLAUDE_CONFIG_DIR })).toBe(
          join(homedir(), ".claude", "sessions"),
        );
      }
    });
  });
});
