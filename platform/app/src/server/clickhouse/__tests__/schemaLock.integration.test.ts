/**
 * @vitest-environment node
 *
 * Mutual exclusion, proved the only way it can be: with real processes.
 *
 * The lock exists because vitest runs test files in separate forks, so a test
 * that shares one process with its rival proves nothing about the property
 * under test. Each contender here is its own node process contending for one
 * lock file, exactly as two vitest workers do.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

const CONTENDER = join(__dirname, "fixtures", "schemaLockContender.ts");

/**
 * Resolved rather than assembled from a bin path: pnpm's layout decides where
 * the shim lands, and a wrong guess would fail as a spawn error that says
 * nothing about the lock.
 */
const TSX_CLI = require.resolve("tsx/cli");

let lockPath: string;
let journalPath: string;

function startContender({
  id,
  holdMs,
}: {
  id: string;
  holdMs: number;
}): Promise<unknown> {
  return run(
    process.execPath,
    [TSX_CLI, CONTENDER, lockPath, journalPath, id, String(holdMs)],
    { timeout: 60_000 },
  );
}

/**
 * A journal is well formed when every `enter` is followed by its own `exit`
 * before the next `enter`. Any other shape means two processes were inside
 * the critical section together.
 */
function overlappingHolders(journal: string): string[] {
  const overlaps: string[] = [];
  let inside: string | undefined;

  for (const line of journalEvents(journal)) {
    if (line.event === "enter") {
      if (inside !== undefined) {
        overlaps.push(`${line.id} entered while ${inside} held`);
      }
      inside = line.id;
      continue;
    }
    if (inside !== line.id) {
      overlaps.push(`${line.id} exited but ${inside ?? "nobody"} held`);
    }
    inside = undefined;
  }

  return overlaps;
}

function journalEvents(
  journal: string,
): Array<{ event: string; id: string | undefined }> {
  return journal
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [event, id] = line.split(" ");
      return { event: event ?? "", id };
    });
}

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), "schema-lock-x-"));
  lockPath = join(directory, "schema.lock");
  journalPath = join(directory, "journal.txt");
  writeFileSync(journalPath, "");
});

describe("given several processes want the schema lock at once", () => {
  describe("when they all start together", () => {
    /** @scenario "Only one process at a time holds the schema lock" */
    it("lets exactly one hold it at a time", async () => {
      const contenders = ["a", "b", "c", "d"].map((id) =>
        startContender({ id, holdMs: 120 }),
      );

      await Promise.all(contenders);

      const journal = readFileSync(journalPath, "utf-8");
      expect(overlappingHolders(journal)).toEqual([]);
      // Every contender got in, so the lock serialises rather than starves.
      expect(journal.match(/^enter /gm)).toHaveLength(4);
      expect(journal.match(/^exit /gm)).toHaveLength(4);
    }, 90_000);
  });

  describe("when one of them was killed while holding the lock", () => {
    /** @scenario "A lock left by a killed run is recovered" */
    it("recovers the abandoned lock so the others proceed", async () => {
      // A lock file left behind by a process that no longer exists, which is
      // what a SIGKILLed vitest worker leaves.
      const deadPid = 2 ** 31 - 1;
      writeFileSync(
        lockPath,
        `11111111-2222-3333-4444-555555555555 ${deadPid} ${new Date().toISOString()}\n`,
      );

      await Promise.all(
        ["a", "b"].map((id) => startContender({ id, holdMs: 40 })),
      );

      const journal = readFileSync(journalPath, "utf-8");
      expect(overlappingHolders(journal)).toEqual([]);
      expect(journal.match(/^enter /gm)).toHaveLength(2);
    }, 90_000);
  });
});
