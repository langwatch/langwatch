/**
 * Which codex session ran the command, read from the process tree: the first
 * ancestor holding a rollout transcript open is the session asking.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { describe, expect, it } from "vitest";

import {
  type AncestorProbe,
  resolveCodexSessionFromAncestors,
} from "../codex-ancestor-session";

const SESSION_A = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";
const SESSION_B = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c22";

const rolloutOf = (sessionId: string) =>
  `/home/agent/.codex/sessions/2026/08/24/rollout-2026-08-24T10-00-00-${sessionId}.jsonl`;

/** A process tree as a plain map: pid to parent, pid to open files. */
function fakeProbe({
  parents,
  openFiles,
}: {
  parents: Record<number, number>;
  openFiles: Record<number, string[]>;
}): AncestorProbe {
  return {
    parentPidOf: async (pid) => parents[pid] ?? null,
    openFilesOf: async (pid) => openFiles[pid] ?? [],
  };
}

describe("resolving the codex session from the process tree", () => {
  describe("when an ancestor holds a rollout open", () => {
    /** @scenario "The invoking codex session is resolved from the ancestor process that holds the rollout open" */
    it("names that session and the rollout it holds", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 80, 80: 1 },
        openFiles: {
          100: ["/dev/null", "/tmp/scratch"],
          90: ["/usr/lib/libc.so"],
          80: ["/dev/null", rolloutOf(SESSION_A)],
        },
      });

      const found = await resolveCodexSessionFromAncestors({
        startPid: 100,
        probe,
      });

      expect(found?.sessionId).toBe(SESSION_A);
      expect(found?.rolloutPath).toBe(rolloutOf(SESSION_A));
    });
  });

  describe("when the nearest ancestor with a rollout is not the newest writer", () => {
    /** @scenario "The invoking codex session is resolved from the ancestor process that holds the rollout open" */
    it("names the ancestor's session, whatever else is live on the machine", async () => {
      const probe = fakeProbe({
        parents: { 100: 80, 80: 1 },
        openFiles: { 100: [], 80: [rolloutOf(SESSION_A)] },
      });

      const found = await resolveCodexSessionFromAncestors({
        startPid: 100,
        probe,
      });

      // SESSION_B is the newer writer on this machine and is not an ancestor.
      expect(found?.sessionId).toBe(SESSION_A);
      expect(found?.sessionId).not.toBe(SESSION_B);
    });
  });

  describe("when the closest ancestor holding a rollout is nested under another", () => {
    it("stops at the first one going up", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 80, 80: 1 },
        openFiles: {
          90: [rolloutOf(SESSION_A)],
          80: [rolloutOf(SESSION_B)],
        },
      });

      const found = await resolveCodexSessionFromAncestors({
        startPid: 100,
        probe,
      });

      expect(found?.sessionId).toBe(SESSION_A);
    });
  });

  describe("when no ancestor holds a rollout", () => {
    /** @scenario "Ancestor resolution unavailable falls back to recent-rollout inference" */
    it("resolves nothing", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 1 },
        openFiles: { 100: ["/dev/null"], 90: ["/var/log/system.log"] },
      });

      expect(
        await resolveCodexSessionFromAncestors({ startPid: 100, probe }),
      ).toBeNull();
    });
  });

  describe("when listing open files fails, as under a sandbox", () => {
    /** @scenario "Ancestor resolution unavailable falls back to recent-rollout inference" */
    it("resolves nothing instead of throwing", async () => {
      const probe: AncestorProbe = {
        parentPidOf: async (pid) => (pid === 100 ? 90 : null),
        openFilesOf: async () => {
          throw new Error("lsof: permission denied");
        },
      };

      expect(
        await resolveCodexSessionFromAncestors({ startPid: 100, probe }),
      ).toBeNull();
    });
  });

  describe("when reading the parent chain fails", () => {
    it("resolves nothing instead of throwing", async () => {
      const probe: AncestorProbe = {
        parentPidOf: async () => {
          throw new Error("ps: not permitted");
        },
        openFilesOf: async () => [],
      };

      expect(
        await resolveCodexSessionFromAncestors({ startPid: 100, probe }),
      ).toBeNull();
    });
  });

  describe("when the chain is longer than the hop cap", () => {
    it("gives up rather than walk to init", async () => {
      const parents: Record<number, number> = {};
      for (let pid = 100; pid < 200; pid++) parents[pid] = pid + 1;
      const probe = fakeProbe({
        parents,
        openFiles: { 180: [rolloutOf(SESSION_A)] },
      });

      const found = await resolveCodexSessionFromAncestors({
        startPid: 100,
        probe,
        maxHops: 5,
      });

      expect(found).toBeNull();
    });
  });

  describe("when the walk runs out of its time budget", () => {
    it("gives up rather than hold up the agent's turn", async () => {
      let clock = 0;
      const probe: AncestorProbe = {
        parentPidOf: async (pid) => pid + 1,
        openFilesOf: async () => {
          clock += 900;
          return [];
        },
      };

      const found = await resolveCodexSessionFromAncestors({
        startPid: 100,
        probe,
        budgetMs: 2_000,
        nowMs: () => clock,
      });

      expect(found).toBeNull();
    });
  });

  describe("when there is no parent to start from", () => {
    it("resolves nothing", async () => {
      const probe = fakeProbe({ parents: {}, openFiles: {} });

      expect(
        await resolveCodexSessionFromAncestors({ startPid: 1, probe }),
      ).toBeNull();
      expect(
        await resolveCodexSessionFromAncestors({ probe }),
      ).toBeNull();
    });
  });

  describe("when an ancestor holds an unrelated jsonl file open", () => {
    it("does not mistake it for a rollout", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 1 },
        openFiles: { 90: ["/tmp/rollout-notes.jsonl", "/tmp/data.jsonl"] },
      });

      expect(
        await resolveCodexSessionFromAncestors({ startPid: 100, probe }),
      ).toBeNull();
    });
  });
});
