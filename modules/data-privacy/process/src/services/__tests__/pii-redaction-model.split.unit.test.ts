import { formatPiiMarker } from "@langwatch/redaction";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SplittingPresidioChannel } from "../../channels/presidio.channel.ts";
import { clearingOfAnswer } from "../../rules/pii-analysis.rules.ts";
import { PII_REDACTION_MODEL_TIMEOUT_MS } from "../../rules/pii-redaction-model.rules.ts";
import {
  piiRedactionCostNanoUsd,
  piiRedactionSpendRequestId,
} from "../../rules/pii-redaction-spend.rules.ts";
import {
  clearSplitSpan,
  PII_REDACTION_MODEL_PIECE_CHARACTERS,
} from "../../rules/pii-redaction-split.rules.ts";
import { PresidioRedactionService } from "../presidio-redaction.service.ts";
import {
  PROJECT_ID,
  ORGANIZATION_ID,
  KEY,
  PRESIDIO_MASK,
  metrics,
  presidioAnswer,
  planSpanCalls,
  setup,
  piecesOf,
} from "./pii-redaction-model.split-setup.fixture.ts";
import { type FakeTurn, filler, plantedText } from "./pii-redaction-split.fixture.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("PiiRedactionModelService, a long batch with splitting on (ADR-207)", () => {
  /** @scenario "With splitting on, a long batch is split across model calls and masked where the model found it" */
  it("masks every finding of a 20,000-character batch without calling Presidio", async () => {
    const { text, expected, planted } = plantedText([
      filler(2_000),
      { pii: "Maria van der Berg", entity: "PERSON" },
      filler(9_000, 100_000),
      { pii: "NL91ABNA0417164300", entity: "IBAN_CODE" },
      filler(9_000, 200_000),
    ]);
    const { clear, presidioCalls, splitModel } = setup({ planted });

    const cleared = await clear([text]);

    expect(cleared).toEqual([expected]);
    expect(presidioCalls()).toHaveLength(0);
    expect(splitModel.calls).toHaveLength(planSpanCalls([text]).length);
    for (const call of splitModel.calls) {
      expect(call.join("").length).toBeLessThanOrEqual(PII_REDACTION_MODEL_PIECE_CHARACTERS);
    }
    const pieces = piecesOf({ text, calls: splitModel.calls }).toSorted(
      (a, b) => a.start - b.start,
    );
    expect(pieces.every((piece) => piece.start >= 0)).toBe(true);
    expect(pieces[0]?.start).toBe(0);
    expect(pieces.at(-1)?.end).toBe(text.trimEnd().length);
    for (const [i, piece] of pieces.slice(1).entries()) {
      expect(piece.start).toBeLessThan(pieces[i]!.end);
    }
  });

  /** @scenario "A name, an address or an IBAN across a cut is masked whole and nothing found is left unmasked" */
  it("leaves no planted value unmasked at the cuts and in the overlaps", async () => {
    const values = [
      { pii: "Maria van der Berg", entity: "PERSON" },
      { pii: "Keizersgracht 123, Amsterdam", entity: "LOCATION" },
      { pii: "NL91ABNA0417164300", entity: "IBAN_CODE" },
      { pii: "Jan de Vries", entity: "PERSON" },
    ];
    // A value every ~100 characters, so every cut falls on or next to one.
    const parts = (count: number, offset: number) =>
      Array.from({ length: count }, (_, i) => [
        filler(71 + (i % 7)),
        values[(i + offset) % 4]!,
      ]).flat();
    const first = plantedText([filler(3_990), values[0]!, ...parts(90, 1), filler(40)]);
    const second = plantedText([filler(7_950), ...parts(30, 1), filler(40)]);
    const planted = [
      ...first.planted,
      ...second.planted,
      { value: "Maria", entity: "PERSON", score: 0.6 },
    ];
    const { clear, presidioCalls, splitModel } = setup({ planted });

    const cleared = await clear([first.text, second.text]);

    expect(cleared).toEqual([first.expected, second.expected]);
    for (const { value } of planted) {
      expect(cleared.join("\n")).not.toContain(value);
    }
    expect(presidioCalls()).toHaveLength(0);
    const cutInsideAName = splitModel.calls
      .flat()
      .filter((piece) =>
        values.some(
          ({ pii }) =>
            pii.includes(" ") &&
            [...pii.matchAll(/ /g)].some((space) => piece.endsWith(pii.slice(0, space.index))),
        ),
      );
    expect(cutInsideAName.length).toBeGreaterThan(0);
  });

  /** @scenario "A batch over 32,000 characters skips the model even with splitting on" */
  it("splits 32,000 characters and sends 32,001 to Presidio, calling no model", async () => {
    const { clear, presidio, single, splitModel, usage } = setup();
    await clear([filler(32_000)]);
    const splitCalls = splitModel.calls.length;
    presidio.answerWith(presidioAnswer(1));

    const cleared = await clear([filler(32_001)]);

    expect(splitCalls).toBeGreaterThan(0);
    expect(cleared).toEqual([PRESIDIO_MASK]);
    expect(single.calls).toHaveLength(0);
    expect(splitModel.calls).toHaveLength(splitCalls);
    expect(usage.map((line) => line.outcome)).toEqual(["ok", "too_long"]);
  });

  /** @scenario "A piece the model could reshape sends the whole span to Presidio" */
  it("sends a long escaped-JSON-lines text to Presidio, using no piece's findings", async () => {
    const line = `{"log":"${"step\\n".repeat(600)}","payee":"NL91ABNA0417164300"}`;
    const text = [line, line, line].join("\n");
    const unescaped = text.replaceAll("\\n", " n");
    const { clear, presidio, presidioCalls, splitModel, usage, fallbacks, priced } = setup({
      planted: [{ value: "NL91ABNA0417164300", entity: "IBAN_CODE", score: 0.9 }],
    });
    expect(await clear([unescaped])).toEqual([
      unescaped.replaceAll("NL91ABNA0417164300", formatPiiMarker("IBAN_CODE")),
    ]);
    const splitCalls = splitModel.calls.length;
    presidio.answerWith(presidioAnswer(1));

    const cleared = await clear([text]);

    expect(cleared).toEqual([PRESIDIO_MASK]);
    expect(presidioCalls()).toHaveLength(1);
    expect(splitModel.calls).toHaveLength(splitCalls);
    expect(fallbacks).toEqual(["unplaceable"]);
    expect(usage.at(-1)).toMatchObject({
      outcome: "unplaceable",
      durationMs: 0,
      calls: planSpanCalls([text]).length,
    });
    expect(priced).toHaveLength(1); // the unescaped run only
  });

  /** @scenario "A piece whose findings do not rebuild the model's own masked piece sends the whole span to Presidio" */
  it("sends the span to Presidio when a piece's findings do not rebuild its masked text", async () => {
    const { text, expected, planted } = plantedText([
      filler(1_000),
      { pii: "Maria van der Berg", entity: "PERSON" },
      filler(9_000),
    ]);
    const honest = setup({ planted });
    expect(await honest.clear([text])).toEqual([expected]);
    const { clear, presidio, fallbacks, usage, splitModel, priced } = setup({
      planted,
      turns: Array<FakeTurn>(8).fill("lie"),
    });
    presidio.answerWith(presidioAnswer(1));

    expect(await clear([text])).toEqual([PRESIDIO_MASK]);
    expect(splitModel.calls).toHaveLength(planSpanCalls([text]).length);
    expect(fallbacks).toEqual(["unplaceable"]);
    expect(usage).toEqual([
      expect.objectContaining({
        outcome: "unplaceable",
        calls: planSpanCalls([text]).length,
        durationMs: expect.any(Number),
      }),
    ]);
    expect(priced).toEqual([]);
  });

  /** @scenario "A whole text in a split call keeps the model's own masked text" */
  it("gives a whole JSON text and a whole spared text exactly a single call's masking", async () => {
    const json = '{"note":"line\\nMaria van der Berg","n":NaN}';
    const spared = "gpt-5-mini by Maria van der Berg";
    const planted = [{ value: "Maria van der Berg", entity: "PERSON", score: 0.9 }];
    const alone = setup({ planted, split: false });
    const single = await alone.clear([json, spared], { spareNamesAndPlaces: [false, true] });
    const { clear } = setup({ planted });

    const cleared = await clear([filler(9_000), json, spared], {
      spareNamesAndPlaces: [false, false, true],
    });

    expect(cleared.slice(1)).toEqual(single);
    expect(cleared[1]).toBe(`{"note":"line\\n${formatPiiMarker("PERSON")}","n":NaN}`);
  });

  /** @scenario "A whole text in a split call keeps the model's own masked text" */
  it("keeps the model's own mask on a spared whole text when the answer lists no findings", async () => {
    const channel: SplittingPresidioChannel = {
      splits: true,
      detect: async () => ({
        kind: "detected",
        results: [{ status: "processed", raw_response: { anonymized: "<DATE_TIME>" } }],
      }),
    };
    const split = PresidioRedactionService.create({
      presidio: channel,
      metrics,
      timeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
      method: "pii_redaction_model",
    });
    const singleCallClearing = clearingOfAnswer({
      input: "June 12",
      rawResponse: { anonymized: "<DATE_TIME>" },
      spareNamesAndPlaces: true,
    });
    const answers = await split.answers({
      pieces: [{ text: 0, start: 0, end: 7, whole: true }],
      textOf: () => "June 12",
      piiRedactionLevel: "STRICT",
      signal: new AbortController().signal,
    });

    expect(
      clearSplitSpan({
        texts: ["June 12"],
        answers,
        spareNamesAndPlaces: [true],
      }),
    ).toEqual([singleCallClearing.kind === "redacted" ? singleCallClearing.text : ""]);
    expect(singleCallClearing.kind).toBe("redacted");
  });

  /** @scenario "A split span's usage line counts its calls" */
  it("leaves one usage line with the outcome ok, the findings and the number of calls", async () => {
    const { text, planted } = plantedText([
      filler(1_000),
      { pii: "Maria van der Berg", entity: "PERSON" },
      filler(11_000),
    ]);
    const { clear, splitModel, usage } = setup({ planted });

    await clear([text]);

    expect(usage).toEqual([
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        texts: 1,
        characters: text.length,
        findings: 1,
        outcome: "ok",
        calls: splitModel.calls.length,
      }),
    ]);
    expect(splitModel.calls.length).toBeGreaterThan(1);
  });
});

describe("PiiRedactionModelService, where splitting is on (ADR-207 v3)", () => {
  /** @scenario "Splitting is on only where the model is a Lambda function and the organization's split flag is on" */
  it("sends 8,001 characters to Presidio as too_long when the flag is off or the model cannot split", async () => {
    for (const off of [setup({ splitFlag: false }), setup({ split: false })]) {
      off.presidio.answerWith(presidioAnswer(1));
      await expect(off.clear([filler(8_001)])).resolves.toEqual([PRESIDIO_MASK]);
      expect(off.fallbacks).toEqual(["too_long"]);
      expect(off.contexts).toEqual([]);
    }
    const on = setup();
    await on.clear([filler(8_001)]);
    expect(on.contexts.length).toBeGreaterThan(1);
    expect(on.fallbacks).toEqual([]);
  });

  /** @scenario "Splitting is on only where the model is a Lambda function and the organization's split flag is on" */
  it("sends 8,001 characters to Presidio as too_long, with one warning, when the flag cannot be read", async () => {
    const { clear, presidio, single, splitModel, usage, priced, warnings } = setup({
      splitFlag: "unreadable",
    });
    presidio.answerWith(presidioAnswer(1));

    expect(await clear([filler(8_001)])).toEqual([PRESIDIO_MASK]);
    expect(single.calls).toHaveLength(0);
    expect(splitModel.calls).toHaveLength(0);
    expect(priced).toEqual([]);
    expect(usage.map((line) => line.outcome)).toEqual(["too_long"]);
    expect(warnings).toEqual(["PII redaction model split flag could not be read; not splitting"]);
  });

  /** @scenario "Splitting is on only where the model is a Lambda function and the organization's split flag is on" */
  it("reads the split flag only for a batch over 8,000 characters", async () => {
    const { clear, flagReads } = setup();

    await clear([filler(8_000)]);
    const afterShort = flagReads();
    await clear([filler(8_001)]);

    expect(afterShort).toBe(0);
    expect(flagReads()).toBe(1);
  });

  /** @scenario "Split calls go to the model's one endpoint, each naming its context" */
  it("sends a short batch as one single call and a long one as split calls, on the one channel", async () => {
    const { clear, contexts, single, splitModel } = setup();

    await clear([filler(8_000)]);
    await clear([filler(20_000)]);

    expect(contexts[0]).toBe("single");
    expect(contexts.slice(1).every((context) => context === "split")).toBe(true);
    expect(contexts).toHaveLength(1 + planSpanCalls([filler(20_000)]).length);
    expect(single.calls).toHaveLength(1);
    expect(splitModel.calls).toHaveLength(contexts.length - 1);
  });
});

describe("PiiRedactionModelService, pricing a split span (ADR-201 rev, ADR-207)", () => {
  /** @scenario "A split span is priced once on its characters, never on its overlap" */
  it("records one priced fact on 20,000 characters, our cost summed over every call", async () => {
    vi.useFakeTimers();
    const durations = [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000];
    const { clear, splitModel, priced } = setup({
      turns: durations.map((slowMs) => ({ slowMs })),
    });

    const clearing = clear([filler(20_000)]);
    await vi.advanceTimersByTimeAsync(40_000);
    await clearing;

    const made = durations.slice(0, splitModel.calls.length);
    expect(priced).toHaveLength(1); // the unescaped run only
    expect(priced[0]).toMatchObject({ characters: 20_000, priceNanoUsd: 20_000 * 500 });
    expect(priced[0]?.costNanoUsd).toBe(
      made.reduce((total, durationMs) => total + piiRedactionCostNanoUsd({ durationMs }), 0),
    );
  });

  /** @scenario "A split span is priced once on its characters, never on its overlap" */
  it("prices every call on its own run time when the wall clock steps back mid-call", async () => {
    vi.useFakeTimers();
    const { clear, priced } = setup({
      turns: [{ slowMs: 3_000 }, { slowMs: 3_000 }, { slowMs: 3_000 }],
    });

    const clearing = clear([filler(9_000)]);
    await vi.advanceTimersByTimeAsync(1_000);
    vi.setSystemTime(Date.now() - 60_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await clearing;

    expect(priced).toHaveLength(1); // the unescaped run only
    expect(priced[0]?.costNanoUsd).toBe(3 * piiRedactionCostNanoUsd({ durationMs: 3_000 }));
  });

  /** @scenario "The same split span redacted twice is one request" */
  it("gives both runs of a retried split span the request id of an unsplit call", async () => {
    const { clear, priced } = setup();
    const texts = [filler(15_000)];

    await clear(texts, { recordKey: "trace-1:span-1" });
    await clear(texts, { recordKey: "trace-1:span-1" });

    const expectedId = piiRedactionSpendRequestId({
      key: KEY,
      projectId: PROJECT_ID,
      recordKey: "trace-1:span-1",
      texts,
    });
    expect(priced.map((fact) => fact.requestId)).toEqual([expectedId, expectedId]);
  });

  /** @scenario "A split span with a failed call is priced for nobody" */
  it("records nothing when one call fails, and answers with Presidio's clearing", async () => {
    const { clear, presidio, priced, splitModel } = setup({ turns: ["answer", "fail"] });
    presidio.answerWith(presidioAnswer(1));

    expect(await clear([filler(12_000)])).toEqual([PRESIDIO_MASK]);

    expect(splitModel.calls.length).toBeGreaterThanOrEqual(2);
    expect(priced).toHaveLength(0);
  });

  /** @scenario "A span over 32,000 characters is redacted by Presidio and priced for nobody" */
  it("records nothing for 40,000 characters and calls no model", async () => {
    const { clear, presidio, priced, splitModel, single } = setup();
    await clear([filler(32_000)]);
    const splitCalls = splitModel.calls.length;
    presidio.answerWith(presidioAnswer(1));

    expect(await clear([filler(40_000)])).toEqual([PRESIDIO_MASK]);

    expect(priced).toHaveLength(1); // the unescaped run only
    expect(priced[0]?.characters).toBe(32_000);
    expect(splitModel.calls).toHaveLength(splitCalls);
    expect(single.calls).toHaveLength(0);
  });
});
