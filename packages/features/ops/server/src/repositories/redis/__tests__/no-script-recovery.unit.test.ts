import type { ChainableCommander } from "ioredis";
import { describe, expect, it } from "vitest";
import { execWithNoScriptRecovery } from "../queue.repository";

/**
 * A pipeline whose queued commands all come back NOSCRIPT — what Redis returns
 * when a node has no cached copy of the script (restart, SCRIPT FLUSH, or the
 * first call against a fresh cluster node).
 *
 * Tested here rather than against a live Redis on purpose: reaching this state
 * for real needs a global `SCRIPT FLUSH`, which blanks the cache for every
 * other suite sharing the instance and made an unrelated queue suite fail
 * intermittently. The behaviour under test is entirely in the recovery
 * function, so a fake pipeline pins it deterministically and harms nobody.
 */
function pipelineReturning(results: Array<[Error | null, unknown]>): ChainableCommander {
  return { exec: async () => results } as unknown as ChainableCommander;
}

const noScript = (): [Error | null, unknown] => [
  new Error("NOSCRIPT No matching script. Please use EVAL."),
  null,
];

describe("execWithNoScriptRecovery", () => {
  describe("given every queued command came back NOSCRIPT", () => {
    describe("when the batch is resolved", () => {
      it("re-runs each one and returns what the re-run produced", async () => {
        const reran: number[] = [];

        const results = await execWithNoScriptRecovery(
          pipelineReturning([noScript(), noScript()]),
          async (index) => {
            reran.push(index);
            return index === 0 ? 1 : 5;
          },
        );

        // Without this the bulk paths report "nothing to do" on a cold cache:
        // an operator's "unblock everything" silently does nothing.
        expect(reran).toEqual([0, 1]);
        expect(results).toEqual([
          [null, 1],
          [null, 5],
        ]);
      });
    });
  });

  describe("given only some commands came back NOSCRIPT", () => {
    describe("when the batch is resolved", () => {
      it("re-runs only those, leaving the ones that already ran alone", async () => {
        const reran: number[] = [];

        const results = await execWithNoScriptRecovery(
          pipelineReturning([[null, 1], noScript(), [null, 0]]),
          async (index) => {
            reran.push(index);
            return 9;
          },
        );

        // A NOSCRIPT is returned BEFORE the script body executes, so an entry
        // reporting it provably did not run and re-running cannot double-apply.
        // Entries that succeeded must never be re-run — that would be the
        // double-execution a bulk drain cannot afford.
        expect(reran).toEqual([1]);
        expect(results).toEqual([
          [null, 1],
          [null, 9],
          [null, 0],
        ]);
      });
    });
  });

  describe("given a command failed for some other reason", () => {
    describe("when the batch is resolved", () => {
      it("passes the failure through untouched rather than retrying it", async () => {
        const connectionLost: [Error | null, unknown] = [new Error("Connection is closed."), null];
        let wasRerun = false;

        const results = await execWithNoScriptRecovery(
          pipelineReturning([connectionLost]),
          async () => {
            wasRerun = true;
            return 1;
          },
        );

        // Ambiguous failures (a reset after send) may or may not have executed,
        // so leaving them alone is the conservative choice.
        expect(wasRerun).toBe(false);
        expect(results).toEqual([connectionLost]);
      });
    });
  });

  describe("given a re-run itself throws", () => {
    describe("when the batch is resolved", () => {
      it("reports it as that entry's error instead of rejecting the batch", async () => {
        const results = await execWithNoScriptRecovery(
          pipelineReturning([noScript()]),
          async () => {
            throw new Error("still unreachable");
          },
        );

        expect(results[0]![0]).toBeInstanceOf(Error);
        expect((results[0]![0] as Error).message).toBe("still unreachable");
      });
    });
  });

  describe("given the pipeline resolved to nothing", () => {
    describe("when the batch is resolved", () => {
      it("returns an empty batch rather than null", async () => {
        const results = await execWithNoScriptRecovery(
          { exec: async () => null } as unknown as ChainableCommander,
          async () => 1,
        );

        expect(results).toEqual([]);
      });
    });
  });
});
