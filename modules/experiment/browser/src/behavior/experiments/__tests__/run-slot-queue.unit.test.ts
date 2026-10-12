/** @see modules/experiment/specs/experiment-list-page.feature */
import { describe, expect, it, vi } from "vitest";

import { createRunSlotQueue } from "../run-slot-queue.ts";

describe("given a queue with four slots", () => {
  /** @scenario At most four rows' runs are requested at once */
  it("grants the first four requests and makes the rest wait", () => {
    const queue = createRunSlotQueue(4);
    for (const id of ["a", "b", "c", "d", "e", "f"]) queue.request(id);
    expect(["a", "b", "c", "d", "e", "f"].map(queue.granted)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("hands a released slot to the longest waiting request", () => {
    const queue = createRunSlotQueue(2);
    for (const id of ["a", "b", "c", "d"]) queue.request(id);
    queue.release("a");
    expect(["b", "c", "d"].map(queue.granted)).toEqual([true, true, false]);
    queue.release("b");
    expect(queue.granted("d")).toBe(true);
  });

  it("drops a waiting request that goes away, without freeing a slot", () => {
    const queue = createRunSlotQueue(1);
    queue.request("a");
    queue.request("b");
    queue.request("c");
    queue.release("b");
    queue.release("a");
    expect(queue.granted("c")).toBe(true);
  });

  it("ignores a repeated request and a release of an unknown id", () => {
    const queue = createRunSlotQueue(1);
    const listener = vi.fn();
    queue.subscribe(listener);
    queue.request("a");
    queue.request("a");
    queue.release("zzz");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(queue.granted("a")).toBe(true);
  });

  it("tells listeners when a slot is granted, and stops after they unsubscribe", () => {
    const queue = createRunSlotQueue(1);
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.request("a");
    queue.release("a");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    queue.request("b");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
