import { formatPiiMarker } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";

import { filler, isPythonSpace } from "../../services/__tests__/pii-redaction-split.fixture.ts";
import {
  clearSplitSpan,
  fitsSpanBudget,
  isPlaceablePiece,
  PII_REDACTION_MODEL_PIECE_CHARACTERS,
  type PieceAnswer,
  planSpan,
  type SplitCall,
  splitFindingsCount,
} from "../pii-redaction-split.rules.ts";

function callCharacters({ call }: { call: SplitCall }): number {
  return call.pieces.reduce((total, piece) => total + (piece.end - piece.start), 0);
}

function splitCalls(texts: readonly string[]): readonly SplitCall[] {
  const plan = planSpan({ texts, splitting: true });
  if (plan.kind !== "split") throw new Error(`expected a split plan, got ${plan.kind}`);
  return plan.calls;
}

describe("planSpan", () => {
  /** @scenario "The 8,000 and 32,000 character limits route a batch to one call, split calls or Presidio" */
  it("sends 8,000 in one call, splits 8,001 and 32,000, and sends 32,001 to Presidio", () => {
    const kindOf = (length: number) => planSpan({ texts: [filler(length)], splitting: true }).kind;

    expect([8_000, 8_001, 32_000, 32_001].map(kindOf)).toEqual([
      "single",
      "split",
      "split",
      "too_long",
    ]);
    expect(planSpan({ texts: [filler(4_000), filler(4_001)], splitting: true }).kind).toBe("split");
    const cut = splitCalls([filler(4_000), filler(4_001)]).flatMap((call) =>
      call.pieces.filter((piece) => piece.text === 1),
    );
    // The cut falls at 3,999, before a space; the character 200 before it (3,799) is a space, so
    // the second piece starts on the word ending there, at 3,796, and runs to the end.
    expect([filler(4_001)[3_999], filler(4_001)[3_799]]).toEqual([" ", " "]);
    expect(cut.map(({ start, end, whole }) => ({ start, end, whole }))).toEqual([
      { start: 0, end: 3_999, whole: false },
      { start: 3_796, end: 4_001, whole: false },
    ]);
  });

  /** @scenario "Splitting is on only where the model is a Lambda function and the organization's split flag is on" */
  it("keeps today's 8,000 cap when splitting is off, and splits when it is on", () => {
    expect(planSpan({ texts: [filler(8_001)], splitting: false }).kind).toBe("too_long");
    expect(planSpan({ texts: [filler(8_001)], splitting: true }).kind).toBe("split");
  });

  /** @scenario "With splitting on, a long batch is split across model calls and masked where the model found it" */
  it("cuts a long text at whitespace into pieces of at most 4,000 that overlap by 200", () => {
    const text = filler(20_000);
    const calls = splitCalls([text]);
    const pieces = calls.flatMap((call) => call.pieces);

    for (const call of calls) {
      expect(callCharacters({ call })).toBeLessThanOrEqual(PII_REDACTION_MODEL_PIECE_CHARACTERS);
    }
    expect(pieces[0]?.start).toBe(0);
    expect(pieces.at(-1)?.end).toBe(text.trimEnd().length);
    // The rule, written out: a piece ends before the last whitespace run within 4,000 of its
    // start; the next starts at the word holding the character 200 before that end.
    const space = isPythonSpace;
    let start = 0;
    for (const piece of pieces) {
      expect(piece.start).toBe(start);
      if (piece.end === text.trimEnd().length) break;
      let end = start + 4_000;
      while (!space(text[end])) end--;
      while (space(text[end - 1])) end--;
      expect(piece.end).toBe(end);
      start = end - 200;
      while (!space(text[start - 1])) start--;
      expect(piece.end - start).toBeLessThan(230);
      expect(piece.whole).toBe(false);
    }
  });

  /** @scenario "With splitting on, a long batch is split across model calls and masked where the model found it" */
  it("packs texts of 4,000 or less whole, sharing calls, never past 4,000 characters a call", () => {
    const texts = [filler(9_000), filler(1_500), filler(2_000), filler(4_000)];
    const calls = splitCalls(texts);
    const wholes = calls.flatMap((call) => call.pieces).filter((piece) => piece.whole);

    expect(wholes.map((piece) => piece.text).toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(calls.some((call) => call.pieces.filter((piece) => piece.whole).length === 2)).toBe(
      true,
    );
    expect(calls.filter((call) => call.pieces.some((piece) => piece.text === 3))).toEqual([
      { pieces: [{ text: 3, start: 0, end: 4_000, whole: true }] },
    ]);
    for (const piece of wholes) {
      expect(piece).toMatchObject({ start: 0, end: texts[piece.text]!.length });
    }
    for (const call of calls) {
      expect(callCharacters({ call })).toBeLessThanOrEqual(PII_REDACTION_MODEL_PIECE_CHARACTERS);
    }
  });

  /** @scenario "A name, an address or an IBAN across a cut is masked whole and nothing found is left unmasked" */
  it("overlaps a cut inside a word of 4,000 or more by 200, so a value across it is whole", () => {
    const value = "MariavanderBerg_NL91ABNA04";
    const text = `${"x".repeat(3_990)}${value}${"y".repeat(6_000)}`;
    const pieces = splitCalls([text]).flatMap((call) => call.pieces);
    const slices = pieces.map((piece) => text.slice(piece.start, piece.end));

    expect(slices.some((slice) => slice.includes(value))).toBe(true);
    for (const [i, piece] of pieces.slice(1).entries()) {
      expect(pieces[i]!.end - piece.start).toBeGreaterThanOrEqual(200);
    }
  });

  /** @scenario "With splitting on, a long batch is split across model calls and masked where the model found it" */
  it("cuts at whitespace that leaves 2,000 characters, and inside a word when it leaves 1,999", () => {
    const firstPiece = (head: number) =>
      splitCalls([`${"a".repeat(head)} ${"b".repeat(7_000)}`]).flatMap((call) => call.pieces)[0];

    expect(firstPiece(2_000)).toMatchObject({ start: 0, end: 2_000 });
    expect(firstPiece(1_999)).toMatchObject({
      start: 0,
      end: PII_REDACTION_MODEL_PIECE_CHARACTERS,
    });
  });

  /** @scenario "With splitting on, a long batch is split across model calls and masked where the model found it" */
  it("repeats less only after a whitespace run covering the 800 characters before the overlap", () => {
    // A cut at 3,950 puts the overlap at 3,750; the run ends at 3,900, before 50 y's.
    const secondStart = (run: number) =>
      splitCalls([
        `${"x".repeat(3_900 - run)}${" ".repeat(run)}${"y".repeat(50)} ${"z".repeat(5_000)}`,
      ]).flatMap((call) => call.pieces)[1]?.start;

    expect(secondStart(950)).toBe(3_900);
    expect(secondStart(949)).toBe(2_950);
  });

  /** @scenario "A name, an address or an IBAN across a cut is masked whole and nothing found is left unmasked" */
  it("keeps 200 characters of overlap when the cut falls after a long whitespace run", () => {
    const text = `${"x".repeat(3_700)}${" ".repeat(250)}${"b".repeat(50)} ${"y".repeat(5_000)}`;
    const pieces = splitCalls([text]).flatMap((call) => call.pieces);

    for (const [i, piece] of pieces.slice(1).entries()) {
      expect(pieces[i]!.end - piece.start).toBeGreaterThanOrEqual(200);
    }
  });

  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("starts the next piece on a whole emoji, not the space after it", () => {
    const text = `${"x".repeat(3_698)}😀${" ".repeat(250)}${"b".repeat(50)} ${"y".repeat(5_000)}`;
    const pieces = splitCalls([text]).flatMap((call) => call.pieces);

    for (const piece of pieces) {
      expect(isPlaceablePiece(text.slice(piece.start, piece.end))).toBe(true);
    }
    // The next piece starts on the emoji's high surrogate, never on its low one or the space.
    expect(pieces[1]?.start).toBe(3_698);
    expect(text.codePointAt(3_698)).toBe(0x1f600);
  });

  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("moves past a whitespace run longer than a piece instead of cutting it again", () => {
    const text = `a${" ".repeat(8_000)}b`;

    expect(splitCalls([text]).flatMap((call) => call.pieces)).toEqual([
      { text: 0, start: 0, end: 1, whole: false },
      { text: 0, start: 8_001, end: 8_002, whole: false },
    ]);
  });

  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("starts no piece on a space after a piece that is mostly one long word", () => {
    const text = `${"w".repeat(3_900)} ${"ab ".repeat(3_000)}`;
    const pieces = splitCalls([text]).flatMap((call) => call.pieces);

    for (const piece of pieces) {
      expect(isPlaceablePiece(text.slice(piece.start, piece.end))).toBe(true);
    }
  });

  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("never cuts a piece to start or end on a character the model trims, U+0085 included", () => {
    const text = `${filler(3_990)}\u0085 ${"x".repeat(20)} ${filler(6_000)}`;
    const pieces = splitCalls([text]).flatMap((call) => call.pieces);

    expect(pieces[0]?.end).toBe(filler(3_990).trimEnd().length);
    for (const piece of pieces) {
      const slice = text.slice(piece.start, piece.end);
      expect([isPythonSpace(slice[0]), isPythonSpace(slice.at(-1))]).toEqual([false, false]);
    }
  });
});

describe("fitsSpanBudget", () => {
  /** @scenario "A split span runs two calls at once and its later pieces on the slots it holds" */
  it("fits 32,000 characters on two slots and not on one", () => {
    const calls = splitCalls([filler(32_000)]);

    expect(fitsSpanBudget({ calls, slots: 2 })).toBe(true);
    expect(fitsSpanBudget({ calls, slots: 1 })).toBe(false);
  });
});

describe("isPlaceablePiece", () => {
  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("refuses a piece with a backslash that reads as JSON, or a trimmed edge, and accepts an emoji", () => {
    expect(isPlaceablePiece('{"log":"a\\nb","payee":"x"}')).toBe(false);
    expect(isPlaceablePiece('"Maria\\nlives here"')).toBe(false);
    expect(isPlaceablePiece('{"v":NaN,"log":"a\\nb"}')).toBe(false);
    expect(isPlaceablePiece('[-Infinity,"a\\tb"]')).toBe(false);
    expect(isPlaceablePiece("\u0085Maria")).toBe(false);
    expect(isPlaceablePiece("Maria ")).toBe(false);
    expect(isPlaceablePiece("call 😀 Maria now")).toBe(true);
  });

  /** @scenario "A long escaped JSON message list splits and every piece is placed" */
  it("places every cut piece of a long escaped JSON message list", () => {
    const turn = (index: number) => ({
      role: index % 2 ? "assistant" : "user",
      content: `Turn ${index}: "Maria Lopez" moved to 742 Evergreen Terrace.\nShe asked about order ${index}.\t(${filler(120)})`,
    });
    const text = JSON.stringify(Array.from({ length: 80 }, (_, index) => turn(index))).slice(
      0,
      20_000,
    );
    const plan = planSpan({ texts: [text], splitting: true });

    expect(text).toContain("\\n");
    expect(plan.kind).toBe("split");
    const pieces = plan.kind === "split" ? plan.calls.flatMap((call) => call.pieces) : [];
    expect(pieces.length).toBeGreaterThan(4);
    for (const piece of pieces) {
      expect(isPlaceablePiece(text.slice(piece.start, piece.end))).toBe(true);
    }
  });
});

describe("splitFindingsCount", () => {
  /** @scenario "A split span's usage line counts its calls" */
  it("counts a name two pieces both found once, after an emoji earlier in the text", () => {
    const text = `${"😀".repeat(300)}${"x".repeat(3_250)}Alice${"y".repeat(5_000)}`;
    const finding = (start: number) => ({
      entity_type: "PERSON",
      start,
      end: start + 5,
      score: 0.9,
    });
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: 3_900, whole: false },
        findings: [finding(3_550)],
        anonymized: "",
      },
      {
        piece: { text: 0, start: 3_800, end: text.length, whole: false },
        findings: [finding(50)],
        anonymized: "",
      },
    ];

    expect(splitFindingsCount({ texts: [text], answers })).toBe(1);
  });
});

describe("clearSplitSpan", () => {
  const PERSON = formatPiiMarker("PERSON");
  const IBAN = formatPiiMarker("IBAN_CODE");

  /** @scenario "A name, an address or an IBAN across a cut is masked whole and nothing found is left unmasked" */
  it.each([
    { shortScore: 0.6, wholeScore: 0.9, label: "LOCATION" },
    { shortScore: 0.9, wholeScore: 0.6, label: "PERSON" },
  ])(
    "masks a name found short in one piece and whole in the next over the widest range, as $label",
    ({ shortScore, wholeScore, label }) => {
      const text = "hello Maria van der Berg there";
      const answers: PieceAnswer[] = [
        {
          piece: { text: 0, start: 0, end: 15, whole: false },
          findings: [{ entity_type: "PERSON", start: 6, end: 11, score: shortScore }],
          anonymized: "hello <PERSON> van",
        },
        {
          piece: { text: 0, start: 6, end: 30, whole: false },
          findings: [{ entity_type: "LOCATION", start: 0, end: 18, score: wholeScore }],
          anonymized: "<LOCATION> there",
        },
      ];

      expect(clearSplitSpan({ texts: [text], answers })).toEqual([
        `hello ${formatPiiMarker(label)} there`,
      ]);
    },
  );

  /** @scenario "A long escaped JSON message list splits and every piece is placed" */
  it("masks a name in a cut of escaped JSON and keeps the escapes as stored", () => {
    const text = 'x","content":"Hi\\nMaria Lopez lives here\\tok"},{"role":"user';
    const start = text.indexOf("Maria");
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: text.length, whole: false },
        findings: [{ entity_type: "PERSON", start, end: start + 11, score: 0.9 }],
        anonymized: `${text.slice(0, start)}<PERSON>${text.slice(start + 11)}`,
      },
    ];

    expect(clearSplitSpan({ texts: [text], answers })).toEqual([
      `x","content":"Hi\\n${PERSON} lives here\\tok"},{"role":"user`,
    ]);
  });

  /** @scenario "A piece whose findings do not rebuild the model's own masked piece sends the whole span to Presidio" */
  it("refuses a piece whose findings do not rebuild the model's own masked piece", () => {
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: 17, whole: false },
        findings: [{ entity_type: "PERSON", start: 7, end: 12, score: 0.9 }],
        anonymized: "hello <PERSON> now x",
      },
    ];

    const honest: PieceAnswer[] = [
      { ...answers[0]!, findings: [{ entity_type: "PERSON", start: 6, end: 11, score: 0.9 }] },
    ];

    expect(clearSplitSpan({ texts: ["hello Maria now x"], answers })).toBe("unplaceable");
    expect(clearSplitSpan({ texts: ["hello Maria now x"], answers: honest })).toEqual([
      `hello ${PERSON} now x`,
    ]);
  });

  /** @scenario "A piece whose findings do not rebuild the model's own masked piece sends the whole span to Presidio" */
  it("places a name after an emoji on the name, the model counting code points", () => {
    const text = "hi 😀 Maria ok";
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: text.length, whole: false },
        findings: [{ entity_type: "PERSON", start: 5, end: 10, score: 0.9 }],
        anonymized: "hi 😀 <PERSON> ok",
      },
    ];

    expect(clearSplitSpan({ texts: [text], answers })).toEqual([`hi 😀 ${PERSON} ok`]);
  });

  /** @scenario "A piece whose findings do not rebuild the model's own masked piece sends the whole span to Presidio" */
  it("refuses a finding that ends past the piece, even where the emoji conversion would clamp it", () => {
    const text = "hi 😀 Maria";
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: text.length, whole: false },
        findings: [{ entity_type: "PERSON", start: 5, end: 11, score: 0.9 }],
        anonymized: "hi 😀 <PERSON>",
      },
    ];

    expect(clearSplitSpan({ texts: [text], answers })).toBe("unplaceable");
  });

  /** @scenario "A spared text in a split span keeps its names and places but still masks an IBAN they overlap" */
  it("drops spared names before merging, so an IBAN a name overlaps is still masked", () => {
    const text = "pay Anna NL91ABNA0417164300 now";
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: text.length, whole: false },
        findings: [
          { entity_type: "PERSON", start: 4, end: 14, score: 0.95 },
          { entity_type: "IBAN_CODE", start: 9, end: 27, score: 0.8 },
        ],
        anonymized: "pay <PERSON> now",
      },
    ];

    expect(clearSplitSpan({ texts: [text], answers, spareNamesAndPlaces: [true] })).toEqual([
      `pay Anna ${IBAN} now`,
    ]);
  });

  /** @scenario "A piece whose findings do not rebuild the model's own masked piece sends the whole span to Presidio" */
  it("refuses a whole text the model answered without its masked text, unless it is blank", () => {
    const answer = (
      text: string,
      findings: unknown,
      anonymized: string | null = null,
    ): PieceAnswer => ({
      piece: { text: 0, start: 0, end: text.length, whole: true },
      findings,
      anonymized,
    });
    const found = [{ entity_type: "PERSON", start: 6, end: 11, score: 0.9 }];

    expect(
      clearSplitSpan({ texts: ["hello Maria"], answers: [answer("hello Maria", found)] }),
    ).toBe("unplaceable");
    expect(
      clearSplitSpan({ texts: ["hello Maria"], answers: [answer("hello Maria", undefined)] }),
    ).toBe("unplaceable");
    expect(
      clearSplitSpan({ texts: ["hello Maria"], answers: [answer("hello Maria", found, "")] }),
    ).toBe("unplaceable");
    expect(clearSplitSpan({ texts: ["  \n"], answers: [answer("  \n", undefined)] })).toEqual([
      null,
    ]);
    expect(clearSplitSpan({ texts: ["  \n"], answers: [answer("  \n", [], "")] })).toEqual([null]);
  });

  /** @scenario "A whole text in a split call keeps the model's own masked text" */
  it("keeps the model's own masked text for a whole JSON text", () => {
    const json = '{"note":"line\\nMaria"}';
    const answers: PieceAnswer[] = [
      {
        piece: { text: 0, start: 0, end: json.length, whole: true },
        findings: [{ entity_type: "PERSON", start: 14, end: 19, score: 0.9 }],
        anonymized: '{"note":"line\\n<PERSON>"}',
      },
    ];

    expect(clearSplitSpan({ texts: [json], answers })).toEqual([`{"note":"line\\n${PERSON}"}`]);
  });
});
