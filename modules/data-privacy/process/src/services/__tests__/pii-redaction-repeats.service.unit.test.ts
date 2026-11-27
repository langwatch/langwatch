import { describe, expect, it } from "vitest";

import {
  PII_REDACTION_REPEAT_MIN_CHARACTERS,
  PiiRedactionRepeatsService,
} from "../pii-redaction-repeats.service.ts";

const TEXT = "a".repeat(2_500);
const TEN_MINUTES = 10 * 60_000;
const SCOPE = {
  organizationId: "org-1",
  piiRedactionLevel: "STRICT",
  entities: ["PERSON", "LOCATION"],
  spareNamesAndPlaces: [false],
};

function holding({ now = () => 0 }: { now?: () => number } = {}) {
  const repeats = PiiRedactionRepeatsService.create({ now });
  repeats.remember({ scope: SCOPE, texts: [TEXT], cleared: ["<held>"] });
  return repeats;
}

/** Holds `count` other long texts after whatever the service already holds. */
function holdNewer({ repeats, count }: { repeats: PiiRedactionRepeatsService; count: number }) {
  for (let index = 0; index < count; index++) {
    const text = `${index}`.padEnd(2_000, "b");
    repeats.remember({ scope: SCOPE, texts: [text], cleared: [null] });
  }
}

const isHeld = ({ repeats, text = TEXT }: { repeats: PiiRedactionRepeatsService; text?: string }) =>
  repeats.recall({ scope: SCOPE, texts: [text] }).pending.length === 0;

describe("PiiRedactionRepeatsService", () => {
  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("reuses a held text in the same scope, entities in any order", () => {
    const recall = holding().recall({
      scope: { ...SCOPE, entities: ["LOCATION", "PERSON"] },
      texts: [TEXT],
    });

    expect(recall.pending).toEqual([]);
    expect(recall.merge([])).toEqual(["<held>"]);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it.each([
    { organizationId: "org-2" },
    { piiRedactionLevel: "ESSENTIAL" },
    { entities: ["PERSON"] },
    { spareNamesAndPlaces: [true] },
  ])("sends it again with $0 changed", (change) => {
    const recall = holding().recall({ scope: { ...SCOPE, ...change }, texts: [TEXT] });

    expect(recall.pending).toEqual([0]);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("holds a text until ten minutes have passed, not a millisecond longer", () => {
    let now = 0;
    const repeats = holding({ now: () => now });

    now = TEN_MINUTES - 1;
    expect(isHeld({ repeats })).toBe(true);
    const fresh = holding({ now: () => now });
    now = TEN_MINUTES * 2 - 1;
    expect(isHeld({ repeats: fresh })).toBe(false);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("keeps a text through 255 newer ones, drops it at 256, and a recall keeps it fresh", () => {
    const kept = holding();
    holdNewer({ repeats: kept, count: 255 });
    expect(isHeld({ repeats: kept })).toBe(true);

    const dropped = holding();
    holdNewer({ repeats: dropped, count: 256 });
    expect(isHeld({ repeats: dropped })).toBe(false);

    const refreshed = holding();
    holdNewer({ repeats: refreshed, count: 200 });
    isHeld({ repeats: refreshed });
    holdNewer({ repeats: refreshed, count: 100 });
    expect(isHeld({ repeats: refreshed })).toBe(true);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("never holds a short text, a text cut only because its batch was long, or a short answer", () => {
    const repeats = PiiRedactionRepeatsService.create({ now: () => 0 });
    const short = "c".repeat(PII_REDACTION_REPEAT_MIN_CHARACTERS - 1);
    const cutBesideAnother = "d".repeat(5_000);
    const wholeBesideIt = "e".repeat(4_000);
    repeats.remember({ scope: SCOPE, texts: [short], cleared: ["x"] });
    repeats.remember({
      scope: { ...SCOPE, spareNamesAndPlaces: undefined },
      texts: [cutBesideAnother, wholeBesideIt],
      cleared: ["x", "y"],
    });
    repeats.remember({ scope: SCOPE, texts: [TEXT, short], cleared: ["x"] });

    const scope = { ...SCOPE, spareNamesAndPlaces: undefined };
    expect(repeats.recall({ scope, texts: [short, TEXT, cutBesideAnother] }).pending).toEqual([
      0, 1, 2,
    ]);
    expect(repeats.recall({ scope, texts: [wholeBesideIt] }).pending).toEqual([]);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("merges sent answers in order around held ones, and refuses a short clearing", () => {
    const scope = { ...SCOPE, spareNamesAndPlaces: undefined };
    const repeats = PiiRedactionRepeatsService.create({ now: () => 0 });
    repeats.remember({ scope, texts: [TEXT], cleared: ["<held>"] });
    const mixed = repeats.recall({ scope, texts: ["one", TEXT, "two"] });

    expect(mixed.pending).toEqual([0, 2]);
    expect(mixed.merge(["1", "2"])).toEqual(["1", "<held>", "2"]);
    expect(() => mixed.merge(["1"])).toThrow("does not answer every text sent");
  });
});
