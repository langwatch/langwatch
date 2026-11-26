/**
 * A routed judged query's cost ceiling (ADR-190 decision 13).
 * @see specs/lwql/eval-functions.feature
 */
import { describe, expect, it } from "vitest";

import { InstantEvalQueryCostCeilingService } from "../instant-eval-query-cost-ceiling.service.ts";

/** Lets every settled promise's continuation run. */
const flushed = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("InstantEvalQueryCostCeilingService", () => {
  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("holds sends while billed plus held stays within the ceiling", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });

    expect(await ceiling.hold(60)).toBe(true);
    expect(await ceiling.hold(40)).toBe(true);
  });

  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("frees a settled hold and counts what the send billed in its place", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    await ceiling.hold(60);
    ceiling.settle({ heldNanoUsd: 60, costNanoUsd: 10 });

    expect(await ceiling.hold(90)).toBe(true);
    ceiling.settle({ heldNanoUsd: 90, costNanoUsd: 90 });
    expect(await ceiling.hold(1)).toBe(false);
  });

  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("refuses at once, holding nothing, a send that passes the ceiling with nothing held", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });

    expect(await ceiling.hold(101)).toBe(false);
    expect(await ceiling.hold(100)).toBe(true);
  });

  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("never holds a worst case that is not a finite cost", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });

    expect(await ceiling.hold(Number.POSITIVE_INFINITY)).toBe(false);
    expect(await ceiling.hold(Number.NaN)).toBe(false);
    expect(await ceiling.hold(-1)).toBe(false);
    expect(await ceiling.hold(100)).toBe(true);
  });

  /** @scenario "A send that fits only once sends in flight settle waits for them" */
  it("waits for a hold in flight to settle, then holds the send that now fits", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    await ceiling.hold(60);
    let answer: boolean | undefined;
    void ceiling.hold(60).then((isHeld) => (answer = isHeld));
    await flushed();

    expect(answer).toBeUndefined();
    ceiling.settle({ heldNanoUsd: 60, costNanoUsd: 30 });
    await flushed();
    expect(answer).toBe(true);
  });

  /** @scenario "A send that fits only once sends in flight settle waits for them" */
  it("refuses a waiting send once what was billed leaves it no room even with nothing held", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    await ceiling.hold(60);
    const waiting = ceiling.hold(60);

    ceiling.settle({ heldNanoUsd: 60, costNanoUsd: 50 });

    expect(await waiting).toBe(false);
    expect(await ceiling.hold(50)).toBe(true);
  });

  /** @scenario "A send that fits only once sends in flight settle waits for them" */
  it("rejects a waiting send with the caller's stop and holds nothing for it", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    await ceiling.hold(60);
    const stop = new AbortController();
    const waiting = ceiling.hold(60, stop.signal);

    stop.abort(new Error("stopped"));

    await expect(waiting).rejects.toThrow("stopped");
    ceiling.settle({ heldNanoUsd: 60, costNanoUsd: 0 });
    expect(await ceiling.hold(100)).toBe(true);
  });

  /** @scenario "A send that fits only once sends in flight settle waits for them" */
  it("keeps a later send that fits now waiting behind an earlier one, and grants them in order", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    await ceiling.hold(60);
    const granted: string[] = [];
    const first = ceiling.hold(60).then((isHeld) => granted.push(`first:${isHeld}`));
    const second = ceiling.hold(30).then((isHeld) => granted.push(`second:${isHeld}`));
    await flushed();

    expect(granted).toEqual([]);
    ceiling.settle({ heldNanoUsd: 60, costNanoUsd: 0 });
    await Promise.all([first, second]);
    expect(granted).toEqual(["first:true", "second:true"]);
  });

  /** @scenario "A send that fits only once sends in flight settle waits for them" */
  it("wakes the send queued behind a stopped one with no settle", async () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    await ceiling.hold(60);
    const stop = new AbortController();
    const stopped = ceiling.hold(60, stop.signal).catch(() => "stopped");
    let answer: boolean | undefined;
    void ceiling.hold(30).then((isHeld) => (answer = isHeld));
    await flushed();
    expect(answer).toBeUndefined();

    stop.abort(new Error("stopped"));
    await flushed();

    expect(await stopped).toBe("stopped");
    expect(answer).toBe(true);
  });

  /** @scenario "A send that fits only once sends in flight settle waits for them" */
  it("refuses no row of a large parallel query whose real cost stays under the ceiling", async () => {
    // The shipped search route: 128 long rows judged at once, each holding about 0.0076 USD and
    // billed about 40% of that; 128 holds pass the 0.60 USD ceiling, the spend does not.
    const ceilingNanoUsd = 600_000_000;
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd });
    const worstNanoUsd = 7_600_000;
    const billedNanoUsd = 3_000_000;
    let inFlight = 0;
    let mostInFlight = 0;

    const sends = Array.from({ length: 128 }, async () => {
      if (!(await ceiling.hold(worstNanoUsd))) return "query_cost_ceiling";
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await flushed();
      inFlight -= 1;
      ceiling.settle({ heldNanoUsd: worstNanoUsd, costNanoUsd: billedNanoUsd });
      return "answered";
    });
    const outcomes = await Promise.all(sends);

    expect(128 * worstNanoUsd).toBeGreaterThan(ceilingNanoUsd);
    expect(128 * billedNanoUsd).toBeLessThan(ceilingNanoUsd);
    expect(outcomes.filter((outcome) => outcome === "query_cost_ceiling")).toEqual([]);
    expect(mostInFlight * worstNanoUsd).toBeLessThanOrEqual(ceilingNanoUsd);
    expect(mostInFlight).toBeGreaterThan(1);
  });
});
