import { Throttle } from "@langwatch/visual-diff-runner/schedule";
import { describe, expect, it } from "vitest";

import { loadingScale, takeOnceMore } from "../schedule.ts";

describe("takeOnceMore", () => {
  const run = async (
    crashes: boolean[],
  ): Promise<{ result: number; crashed: number; taken: number }> => {
    let taken = 0;
    let crashed = 0;
    const result = await takeOnceMore({
      take: async () => taken++,
      crashed: (attempt) => crashes[attempt] === true,
      onCrash: () => {
        crashed += 1;
      },
    });
    return { result, crashed, taken };
  };

  it("takes a visit that did not crash once", async () => {
    expect(await run([false])).toEqual({ result: 0, crashed: 0, taken: 1 });
  });

  it("retakes a crashed visit once and keeps the retake", async () => {
    expect(await run([true, false])).toEqual({ result: 1, crashed: 1, taken: 2 });
  });

  it("never takes a third time, and reports both crashes", async () => {
    expect(await run([true, true, false])).toEqual({ result: 1, crashed: 2, taken: 2 });
  });
});

describe("throttle wiring", () => {
  it("scales the loading wait by how far the throttle cut the lanes", () => {
    expect(loadingScale({ max: 16, limit: 16 })).toBe(1);
    expect(loadingScale({ max: 16, limit: 4 })).toBe(4);
  });

  it("takes a lane off per crash and per load over the CPUs", () => {
    const machine = { cpus: 8, load: 4 };
    const throttle = new Throttle("fuzz", 8, () => machine);
    expect(throttle.limit()).toBe(8);
    throttle.crashed();
    expect(throttle.limit()).toBe(7);
    machine.load = 16;
    expect(throttle.limit()).toBe(4);
  });
});
