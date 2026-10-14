/**
 * A seeded draft follows what it is about: it waits for it, then goes once it leaves,
 * unless the reader made the text their own.
 *
 * @see modules/dashboard/specs/dashboards-v2.feature
 */
import { describe, expect, it } from "vitest";

import { followScreen, isOnScreen, maySeed, type SeededDraft } from "../langy-draft-scope.ts";

const boardA = { ref: "board-a" };
const boardB = { ref: "board-b" };
const seed = (overrides: Partial<SeededDraft> = {}): SeededDraft => ({
  text: "Write a short report",
  about: boardA,
  contextIds: ["board-a"],
  shown: false,
  ...overrides,
});

describe("isOnScreen", () => {
  it("matches the same thing and the same item in it", () => {
    expect(isOnScreen({ about: boardA, onScreen: { ref: "board-a" } })).toBe(true);
    expect(isOnScreen({ about: { ref: "board-a", itemRef: "w1" }, onScreen: boardA })).toBe(false);
    expect(isOnScreen({ about: boardA, onScreen: null })).toBe(false);
  });
});

describe("maySeed", () => {
  it("fills an empty composer or replaces an untouched seed, never typed text", () => {
    expect(maySeed({ composer: "  ", seeded: null })).toBe(true);
    expect(maySeed({ composer: "Write a short report", seeded: seed() })).toBe(true);
    expect(maySeed({ composer: "why is checkout ", seeded: seed() })).toBe(false);
  });
});

describe("followScreen", () => {
  describe("given a draft whose board has not reached the screen yet", () => {
    /** @scenario "Langy drafts: a draft waits until its board is on screen" */
    it("keeps waiting while another page is still shown, then is marked shown", () => {
      const waiting = followScreen({ seeded: seed(), composer: seed().text, onScreen: boardB });
      expect(waiting).toEqual({ seeded: seed(), drop: false });

      const arrived = followScreen({ seeded: seed(), composer: seed().text, onScreen: boardA });
      expect(arrived).toEqual({ seeded: seed({ shown: true }), drop: false });
    });
  });

  describe("given a shown draft the reader has not touched", () => {
    /** @scenario "Langy drafts: an unsent draft is dropped when the member moves to another board" */
    it("drops it once its board leaves the screen", () => {
      const shown = seed({ shown: true });
      expect(followScreen({ seeded: shown, composer: shown.text, onScreen: boardB })).toEqual({
        seeded: null,
        drop: true,
      });
      expect(followScreen({ seeded: shown, composer: shown.text, onScreen: null }).drop).toBe(true);
    });
  });

  describe("given a draft the reader edited", () => {
    /** @scenario "Langy drafts: text the member typed is never dropped" */
    it("lets it go without touching the composer", () => {
      const shown = seed({ shown: true });
      expect(
        followScreen({ seeded: shown, composer: `${shown.text} for last week`, onScreen: boardB }),
      ).toEqual({ seeded: null, drop: false });
    });
  });
});
