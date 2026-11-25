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
  splitModelTargetOf,
} from "../pii-redaction-split.rules.ts";

const ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-split:live";

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
  });

  /** @scenario "A split model named by anything but a Lambda function ARN splits nothing" */
  it("keeps today's 8,000 cap when no split model is set, and splits when one is", () => {
    expect(planSpan({ texts: [filler(8_001)], splitting: false }).kind).toBe("too_long");
    expect(planSpan({ texts: [filler(8_001)], splitting: true }).kind).toBe("split");
  });

  /** @scenario "With a split model set, a long batch is split across model calls and masked where the model found it" */
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

  it("packs texts of 4,000 or less whole, sharing calls, never past 4,000 characters a call", () => {
    const texts = [filler(9_000), filler(1_500), filler(2_000), filler(4_000)];
    const calls = splitCalls(texts);
    const wholes = calls.flatMap((call) => call.pieces).filter((piece) => piece.whole);

    expect(wholes.map((piece) => piece.text).toSorted()).toEqual([1, 2, 3]);
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

describe("splitModelTargetOf", () => {
  /** @scenario "A split model named by anything but a Lambda function ARN splits nothing" */
  it("splits only for a Lambda function ARN", () => {
    expect(splitModelTargetOf(ARN)).toEqual({
      kind: "lambda",
      functionArn: ARN,
      region: "eu-central-1",
    });
    expect(splitModelTargetOf("http://pii-redaction-model:8080").kind).toBe("invalid");
    expect(splitModelTargetOf("arn:aws:s3:::bucket").kind).toBe("invalid");
    expect(splitModelTargetOf(undefined).kind).toBe("none");
  });
});

describe("isPlaceablePiece", () => {
  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("refuses a piece with a backslash or a trimmed edge, and accepts an emoji", () => {
    expect(isPlaceablePiece('{"log":"a\\nb","payee":"x"}')).toBe(false);
    expect(isPlaceablePiece("\u0085Maria")).toBe(false);
    expect(isPlaceablePiece("Maria ")).toBe(false);
    expect(isPlaceablePiece("call 😀 Maria now")).toBe(true);
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
