import { describe, expect, it } from "vitest";

import {
  PII_REDACTION_REPEAT_MIN_CHARACTERS,
  PiiRedactionRepeatsService,
} from "../pii-redaction-repeats.service.ts";

const TEXT = "a".repeat(2_500);
const SCOPE = {
  organizationId: "org-1",
  piiRedactionLevel: "STRICT",
  entities: ["PERSON", "LOCATION"],
  spareNamesAndPlaces: [false],
};

function holding({ now = () => 0 }: { now?: () => number } = {}) {
  const repeats = PiiRedactionRepeatsService.create({ now });
  repeats.remember({ scope: SCOPE, texts: [TEXT], cleared: ["<held>"], held: [true] });
  return repeats;
}

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
  it("sends it again after ten minutes and once 256 newer texts are held", () => {
    let now = 0;
    const repeats = holding({ now: () => now });
    now = 10 * 60_000;
    expect(repeats.recall({ scope: SCOPE, texts: [TEXT] }).pending).toEqual([0]);

    const crowded = holding();
    for (let index = 0; index < 256; index++) {
      const text = `${index}`.padEnd(2_000, "b");
      crowded.remember({ scope: SCOPE, texts: [text], cleared: [null], held: [true] });
    }
    expect(crowded.recall({ scope: SCOPE, texts: [TEXT] }).pending).toEqual([0]);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("never holds a short text, a text marked not held, or a batch answered short", () => {
    const repeats = PiiRedactionRepeatsService.create({ now: () => 0 });
    const short = "c".repeat(PII_REDACTION_REPEAT_MIN_CHARACTERS - 1);
    repeats.remember({ scope: SCOPE, texts: [short], cleared: ["x"], held: [true] });
    repeats.remember({ scope: SCOPE, texts: [TEXT], cleared: ["x"], held: [false] });
    repeats.remember({ scope: SCOPE, texts: [TEXT, short], cleared: ["x"], held: [true, true] });

    expect(repeats.recall({ scope: SCOPE, texts: [short, TEXT] }).pending).toEqual([0, 1]);
  });

  /** @scenario "A held text is reused only in the same scope and for ten minutes" */
  it("refuses to merge a clearing that does not answer every text sent", () => {
    const recall = holding().recall({ scope: SCOPE, texts: [TEXT, "d".repeat(2_100)] });

    expect(() => recall.merge([])).toThrow("does not answer every text sent");
  });
});
