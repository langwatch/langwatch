/**
 * The castle Snake's rules, played by hand.
 *
 * The whole game is pure and takes its randomness as an argument, so every
 * scenario here is a board set up exactly and stepped once. Nothing mounts,
 * nothing paints, and no scenario depends on a frame ever being drawn.
 *
 * Spec: specs/identity/auth-screen-castle-snake.feature
 */
import { describe, expect, it } from "vitest";

import type { SnakeGame } from "../castleSnake";
import { advance, advanceChaser, createGame, queueTurn } from "../castleSnake";

/** Deterministic: the token always lands on the first free node it tries. */
const noRandom = () => 0;

const board = (overrides: Partial<SnakeGame> = {}): SnakeGame => ({
  ...createGame({ cols: 10, rows: 8, random: noRandom }),
  ...overrides,
});

describe("given a snake running along the grid lines", () => {
  describe("when its head reaches a token", () => {
    /** @scenario The snake runs the lattice and grows on a token */
    it("grows by one and puts another token somewhere free", () => {
      const before = board({
        snake: [
          { x: 4, y: 4 },
          { x: 3, y: 4 },
        ],
        direction: "right",
        token: { x: 5, y: 4 },
      });

      const after = advance(before, noRandom);

      expect(after.snake).toHaveLength(before.snake.length + 1);
      expect(after.snake[0]).toEqual({ x: 5, y: 4 });
      expect(after.eaten).toBe(1);
      // Somewhere free means somewhere the snake is not: a token under the
      // snake is one the player can never reach.
      expect(
        after.snake.some(
          (node) => node.x === after.token.x && node.y === after.token.y,
        ),
      ).toBe(false);
    });
  });

  describe("when its head follows where its own tail is leaving", () => {
    /** @scenario The snake runs the lattice and grows on a token */
    it("survives, because the tail has gone by the time the head arrives", () => {
      // A closed square, nose to tail. Turning down puts the head exactly on
      // the node the tail vacates this same tick.
      const before = board({
        snake: [
          { x: 4, y: 4 },
          { x: 5, y: 4 },
          { x: 5, y: 5 },
          { x: 4, y: 5 },
        ],
        direction: "left",
        queued: "down",
        token: { x: 0, y: 0 },
      });

      const after = advance(before, noRandom);

      expect(after.snake[0]).toEqual({ x: 4, y: 5 });
      expect(after.ending).toBeNull();
    });
  });

  describe("when it doubles back onto its own body", () => {
    /** @scenario The molecule catches the snake */
    it("ends the game", () => {
      const before = board({
        snake: [
          { x: 4, y: 4 },
          { x: 5, y: 4 },
          { x: 5, y: 5 },
          { x: 4, y: 5 },
          { x: 3, y: 5 },
        ],
        direction: "left",
        queued: "down",
        token: { x: 0, y: 0 },
      });

      expect(advance(before, noRandom).ending).toBe("ate-itself");
    });
  });
});

describe("given a snake at the edge of the lattice", () => {
  describe("when it keeps going", () => {
    /** @scenario The ground has no walls */
    it("comes back on the opposite edge", () => {
      const before = board({
        snake: [{ x: 9, y: 4 }],
        direction: "right",
        token: { x: 0, y: 0 },
      });

      expect(advance(before, noRandom).snake[0]).toEqual({ x: 0, y: 4 });
    });

    /** @scenario The ground has no walls */
    it("is chased the short way round, not the long way back", () => {
      const before = board({
        snake: [{ x: 0, y: 4 }],
        chaser: { x: 9, y: 4 },
        token: { x: 5, y: 0 },
      });

      // Walking the whole width to reach a neighbour would make the molecule
      // a decoration rather than a threat.
      expect(advanceChaser(before).chaser).toEqual({ x: 0, y: 4 });
    });
  });
});

describe("given a snake travelling right", () => {
  describe("when I ask it to turn back on itself", () => {
    /** @scenario A fumbled key is not a death sentence */
    it("drops the request and carries on", () => {
      const before = board({ direction: "right", queued: null });

      const after = queueTurn(before, "left");

      expect(after.queued).toBeNull();
      expect(advance(after, noRandom).direction).toBe("right");
    });
  });

  describe("when two turns are asked for inside one tick", () => {
    /** @scenario A fumbled key is not a death sentence */
    it("cannot be folded through its own neck", () => {
      // Both turns are judged against the direction actually being travelled,
      // never against the one queued a moment ago — so no pair of keystrokes
      // between two ticks can add up to a reversal.
      const after = queueTurn(
        queueTurn(board({ direction: "right" }), "up"),
        "left",
      );

      expect(after.queued).toBe("up");
    });
  });
});

describe("given the molecule one step from the snake", () => {
  describe("when it takes that step", () => {
    /** @scenario The molecule catches the snake */
    it("ends the game", () => {
      const before = board({
        snake: [{ x: 4, y: 4 }],
        chaser: { x: 5, y: 4 },
        token: { x: 0, y: 0 },
      });

      expect(advanceChaser(before).ending).toBe("eaten-by-the-molecule");
    });

    /** @scenario The molecule catches the snake */
    it("stops everything until the game is started afresh", () => {
      const ended = advanceChaser(
        board({
          snake: [{ x: 4, y: 4 }],
          chaser: { x: 5, y: 4 },
          token: { x: 0, y: 0 },
        }),
      );

      expect(advance(ended, noRandom)).toBe(ended);
      expect(advanceChaser(ended)).toBe(ended);
      expect(queueTurn(ended, "up")).toBe(ended);
    });
  });
});
