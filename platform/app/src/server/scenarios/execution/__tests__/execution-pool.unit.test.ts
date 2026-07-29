/**
 * Unit tests for ScenarioExecutionPool.
 *
 * The pool is a registry of live children, not a queue: pending work is an
 * outbox row and concurrency is the dispatcher's (ADR-073 step 2). What is
 * left to test is what cancellation depends on.
 *
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioExecutionPool } from "../execution-pool";

function makeFakeChild(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  (child as any).kill = vi.fn();
  (child as any).pid = Math.floor(Math.random() * 100000);
  return child;
}

describe("ScenarioExecutionPool", () => {
  let pool: ScenarioExecutionPool;

  beforeEach(() => {
    pool = new ScenarioExecutionPool();
  });

  describe("when a child is registered", () => {
    it("makes it findable by run id so a cancel can signal it", () => {
      const child = makeFakeChild();
      pool.registerChild("run-1", child);

      expect(pool.runningChildren.get("run-1")).toBe(child);
      expect(pool.activeCount).toBe(1);
    });
  });

  describe("when a child exits", () => {
    it("drops it from the registry", () => {
      pool.registerChild("run-1", makeFakeChild());
      pool.deregisterChild("run-1");

      expect(pool.runningChildren.has("run-1")).toBe(false);
      expect(pool.activeCount).toBe(0);
    });
  });

  describe("wasCancelled", () => {
    it("returns false for non-cancelled runs", () => {
      expect(pool.wasCancelled("run-1")).toBe(false);
    });

    it("returns true after markCancelled", () => {
      pool.markCancelled("run-1");
      expect(pool.wasCancelled("run-1")).toBe(true);
    });

    it("remembers a cancel that arrived before the run was ever registered", () => {
      // The pre-dispatch case: the broadcast lands while the dispatch is
      // still an outbox row, and the executor has to see it before it
      // spawns anything.
      pool.markCancelled("run-1");

      expect(pool.wasCancelled("run-1")).toBe(true);
      expect(pool.activeCount).toBe(0);
    });
  });

  describe("when the pool is drained", () => {
    it("kills every running child", () => {
      const child1 = makeFakeChild();
      const child2 = makeFakeChild();
      pool.registerChild("run-1", child1);
      pool.registerChild("run-2", child2);

      pool.drain();

      expect((child1 as any).kill).toHaveBeenCalledWith("SIGTERM");
      expect((child2 as any).kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});
