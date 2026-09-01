/**
 * Which codex session ran the command, read from the process tree: the first
 * ancestor holding a rollout transcript open is the session asking.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type AncestorProbe,
  readSymlinkedPaths,
  resolveCodexSessionFromAncestors,
} from "../codex-ancestor-session";

const SESSION_A = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";
const SESSION_B = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c22";
const SESSIONS_ROOT = "/home/agent/.codex/sessions";

const rolloutOf = (sessionId: string) =>
  `${SESSIONS_ROOT}/2026/08/24/rollout-2026-08-24T10-00-00-${sessionId}.jsonl`;

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
        sessionsRoot: SESSIONS_ROOT,
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
        sessionsRoot: SESSIONS_ROOT,
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
        sessionsRoot: SESSIONS_ROOT,
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
        await resolveCodexSessionFromAncestors({
          startPid: 100,
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
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
        await resolveCodexSessionFromAncestors({
          startPid: 100,
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
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
        await resolveCodexSessionFromAncestors({
          startPid: 100,
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
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
        sessionsRoot: SESSIONS_ROOT,
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
        sessionsRoot: SESSIONS_ROOT,
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
        await resolveCodexSessionFromAncestors({
          startPid: 1,
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
      ).toBeNull();
      expect(
        await resolveCodexSessionFromAncestors({
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
      ).toBeNull();
    });
  });

  describe("when an ancestor holds a rollout-shaped file outside the sessions tree", () => {
    /** @scenario "A rollout-shaped file outside the codex sessions tree names no session" */
    it("does not treat it as a codex session", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 1 },
        openFiles: {
          90: [
            `/tmp/rollout-2026-08-24T10-00-00-${SESSION_A}.jsonl`,
            `/home/agent/.codex/sessions-evil/rollout-2026-08-24T10-00-00-${SESSION_B}.jsonl`,
          ],
        },
      });

      expect(
        await resolveCodexSessionFromAncestors({
          startPid: 100,
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
      ).toBeNull();
    });

    /** @scenario "A rollout-shaped file outside the codex sessions tree names no session" */
    it("skips it and keeps walking to the real one", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 80, 80: 1 },
        openFiles: {
          90: [`/tmp/rollout-2026-08-24T10-00-00-${SESSION_B}.jsonl`],
          80: [rolloutOf(SESSION_A)],
        },
      });

      const found = await resolveCodexSessionFromAncestors({
        startPid: 100,
        probe,
        sessionsRoot: SESSIONS_ROOT,
      });

      expect(found?.sessionId).toBe(SESSION_A);
    });
  });

  describe("when an ancestor holds an unrelated jsonl file open", () => {
    it("does not mistake it for a rollout", async () => {
      const probe = fakeProbe({
        parents: { 100: 90, 90: 1 },
        openFiles: { 90: ["/tmp/rollout-notes.jsonl", "/tmp/data.jsonl"] },
      });

      expect(
        await resolveCodexSessionFromAncestors({
          startPid: 100,
          probe,
          sessionsRoot: SESSIONS_ROOT,
        }),
      ).toBeNull();
    });
  });
});

describe("resolving a directory of descriptor symlinks", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function fdDirWith(count: number): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-fd-"));
    const target = path.join(dir, "target");
    fs.writeFileSync(target, "");
    const fdDir = path.join(dir, "fd");
    fs.mkdirSync(fdDir);
    for (let i = 0; i < count; i++) {
      fs.symlinkSync(target, path.join(fdDir, String(i)));
    }
    return fdDir;
  }

  describe("when there is time left", () => {
    it("resolves every descriptor", async () => {
      const fdDir = fdDirWith(3);

      const paths = await readSymlinkedPaths({ dir: fdDir, timeoutMs: 5_000 });

      expect(paths).toHaveLength(3);
    });
  });

  describe("when the deadline has already passed", () => {
    /** @scenario "Ancestor resolution unavailable falls back to recent-rollout inference" */
    it("resolves nothing rather than read thousands of descriptors", async () => {
      const fdDir = fdDirWith(3);

      const paths = await readSymlinkedPaths({ dir: fdDir, timeoutMs: 0 });

      expect(paths).toEqual([]);
    });
  });

  describe("when the deadline passes partway through", () => {
    it("stops at the batch boundary instead of finishing the directory", async () => {
      const fdDir = fdDirWith(200);
      let clock = 0;

      const paths = await readSymlinkedPaths({
        dir: fdDir,
        timeoutMs: 100,
        nowMs: () => (clock += 60),
      });

      expect(paths.length).toBeLessThan(200);
    });
  });

  describe("when the directory cannot be read", () => {
    it("resolves nothing instead of throwing", async () => {
      expect(
        await readSymlinkedPaths({
          dir: "/proc/does-not-exist/fd",
          timeoutMs: 1_000,
        }),
      ).toEqual([]);
    });
  });
});
