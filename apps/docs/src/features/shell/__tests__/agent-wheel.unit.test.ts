import { describe, expect, it } from "vitest";

import {
  agentAt,
  approach,
  casinoName,
  CASINO_NAMES,
  CODING_AGENTS,
  flickVelocity,
  nameOpacity,
  reelOffset,
  restingSlot,
  WHEEL,
  wheelOffset,
} from "../model/agent-wheel.ts";

describe("when a reader lets go of the agent wheel", () => {
  /** @scenario "Spin the agent wheel with momentum and land on a real agent" */
  it("carries a flick further the faster it was, up to a top speed, onto a whole agent", () => {
    expect(restingSlot({ position: 2.3, velocity: 0.5 })).toBe(2);
    expect(restingSlot({ position: 0, velocity: 10 })).toBe(Math.round(10 * WHEEL.spinTau));
    expect(restingSlot({ position: 0, velocity: 20 })).toBeGreaterThan(
      restingSlot({ position: 0, velocity: 10 }),
    );
    expect(restingSlot({ position: 0, velocity: 1000 })).toBe(
      Math.round(WHEEL.maxSpeed * WHEEL.spinTau),
    );
    expect(restingSlot({ position: 0, velocity: -1000 })).toBe(
      -Math.round(WHEEL.maxSpeed * WHEEL.spinTau),
    );
  });

  /** @scenario "Spin the agent wheel with momentum and land on a real agent" */
  it("reads the flick from the last moments of the drag, upward turning forward", () => {
    const samples = [
      { time: 0, y: 300 },
      { time: 900, y: 200 },
      { time: 950, y: 170 },
      { time: 1000, y: 140 },
    ];
    expect(flickVelocity({ samples })).toBeCloseTo(60 / WHEEL.stepPx / 0.1);
    expect(flickVelocity({ samples: [{ time: 0, y: 0 }] })).toBe(0);
  });

  /** @scenario "Spin the agent wheel with momentum and land on a real agent" */
  it("eases in by the same share each frame and stops exactly on the agent", () => {
    const path = [0];
    while (path.at(-1) !== 10 && path.length < 600) {
      const position = path.at(-1) ?? 0;
      path.push(approach({ position, goal: 10, tau: WHEEL.spinTau, seconds: 1 / 60 }));
    }
    const steps = path.slice(1, -1).map((position, index) => position - (path[index] ?? 0));
    expect(steps.every((step, index) => index === 0 || step <= (steps[index - 1] ?? 0))).toBe(true);
    expect((10 - (path.at(-2) ?? 0)) * WHEEL.stepPx).toBeLessThan(0.25);
    const position = path.at(-1) ?? Number.NaN;
    const frames = path.length - 1;
    expect(position).toBe(10);
    expect(frames / 60).toBeLessThan(5.5);
    expect(agentAt({ slot: position })).toBe(CODING_AGENTS[0]);
    expect(agentAt({ slot: -1 })).toBe(CODING_AGENTS.at(-1));
  });

  /** @scenario "Spin the agent wheel with momentum and land on a real agent" */
  it("fades names with distance as the resting wheel does, to nothing round the back", () => {
    expect([0, 1, 2].map((distance) => nameOpacity({ distance }))).toEqual([1, 0.4, 0.14]);
    expect(nameOpacity({ distance: -2.5 })).toBe(0);
    expect(nameOpacity({ distance: 0.5 })).toBeCloseTo(0.7);
    for (let index = 0; index < CODING_AGENTS.length; index++)
      expect(reelOffset({ index, position: 1 })).toBe(wheelOffset({ index, chosen: 1 }));
    expect(reelOffset({ index: 0, position: 2.4 })).toBeCloseTo(-2.4);
    expect(reelOffset({ index: 0, position: 2.6 })).toBeCloseTo(2.4);
  });
});

describe("when the agent wheel spins fast", () => {
  const slots = Array.from({ length: 200 }, (_, slot) => slot + 10);

  /** @scenario "Flash casino names past while the agent wheel spins fast" */
  it("shows casino names only above the threshold, more the faster it turns", () => {
    const shown = ({ speed }: { speed: number }) =>
      slots.filter((slot) => casinoName({ slot, speed, target: 0 })).length;
    expect(shown({ speed: WHEEL.casinoSpeed })).toBe(0);
    expect(shown({ speed: WHEEL.casinoSpeed * 1.2 })).toBeGreaterThan(0);
    expect(shown({ speed: WHEEL.maxSpeed })).toBeGreaterThan(
      shown({ speed: WHEEL.casinoSpeed * 1.2 }),
    );
    expect(shown({ speed: -WHEEL.maxSpeed })).toBe(shown({ speed: WHEEL.maxSpeed }));
    expect(shown({ speed: WHEEL.maxSpeed })).toBeLessThan(slots.length);
    const names = new Set(slots.map((slot) => casinoName({ slot, speed: 40, target: 0 })));
    for (const name of names) expect([undefined, ...CASINO_NAMES]).toContain(name);
  });

  /** @scenario "Flash casino names past while the agent wheel spins fast" */
  it("never shows one within two names of where it will stop", () => {
    for (const target of [20, 57, 133])
      for (let slot = target - 2; slot <= target + 2; slot++)
        expect(casinoName({ slot, speed: WHEEL.maxSpeed, target })).toBeUndefined();
  });
});
