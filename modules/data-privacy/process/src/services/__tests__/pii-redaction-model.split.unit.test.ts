import { DATA_PRIVACY_PRESIDIO_TIMEOUT_MS } from "@langwatch/data-privacy-contract";
import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { PiiDetectionOutcome } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ConcurrencyLimiter } from "@langwatch/limiter";
import { formatPiiMarker } from "@langwatch/redaction";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dataPrivacyTestGraph,
  dataPrivacyTestPlacement,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "../../channels/memory/memory.presidio.channel.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import {
  PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
  PII_REDACTION_MODEL_TIMEOUT_MS,
} from "../../rules/pii-redaction-model.rules.ts";
import {
  piiRedactionCostNanoUsd,
  piiRedactionRequestIdKey,
  piiRedactionSpendRequestId,
} from "../../rules/pii-redaction-spend.rules.ts";
import {
  PII_REDACTION_MODEL_PIECE_CHARACTERS,
  planSpan,
  type SplitCall,
} from "../../rules/pii-redaction-split.rules.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { GoogleDlpRedactionService } from "../google-dlp-redaction.service.ts";
import type { PiiRedactionModelFallbackReason } from "../pii-analysis-metrics-otel.service.ts";
import { PiiAnalysisService } from "../pii-analysis.service.ts";
import {
  type PiiRedactionModelUsage,
  PiiRedactionModelService,
} from "../pii-redaction-model.service.ts";
import { PiiRedactionSpendService } from "../pii-redaction-spend.service.ts";
import { PresidioRedactionService } from "../presidio-redaction.service.ts";
import {
  type FakeTurn,
  filler,
  fakePiiModel,
  type PlantedValue,
  plantedText,
} from "./pii-redaction-split.fixture.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;
const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;
const KEY = piiRedactionRequestIdKey("test-key-pepper");
const PRESIDIO_MASK = "presidio cleared it";
const metrics = {
  analysisCalled: () => void 0,
  analysisObserved: () => void 0,
  analysisFinished: () => void 0,
};

/** Presidio's answer for a batch of `count` texts: each one cleared to {@link PRESIDIO_MASK}. */
const presidioAnswer = (count: number): PiiDetectionOutcome => ({
  kind: "detected",
  results: Array.from({ length: count }, () => ({
    status: "processed" as const,
    raw_response: { anonymized: PRESIDIO_MASK },
  })),
});

/** The calls the planner makes for `texts` when a split model is set. */
function planSpanCalls(texts: readonly string[]): readonly SplitCall[] {
  const plan = planSpan({ texts, splitting: true });
  return plan.kind === "split" ? plan.calls : [];
}

function setup({
  planted = [],
  turns = [],
  split = true,
  slots,
}: {
  planted?: readonly PlantedValue[];
  turns?: FakeTurn[];
  split?: boolean;
  slots?: ConcurrencyLimiter;
} = {}) {
  const presidio = MemoryPresidioChannel.create({ endpoint: "http://langevals:5562" });
  const single = fakePiiModel({ planted });
  const splitModel = fakePiiModel({ planted, turns });
  const fallbacks: PiiRedactionModelFallbackReason[] = [];
  const usage: PiiRedactionModelUsage[] = [];
  const priced: PiiRedactionSpendPricedEventData[] = [];
  const modelService = (channel: typeof single.channel) =>
    PresidioRedactionService.create({
      presidio: channel,
      metrics,
      timeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
      method: "pii_redaction_model",
    });

  const analysis = PiiAnalysisService.create({
    presidio: PresidioRedactionService.create({
      presidio,
      metrics,
      timeoutMs: DATA_PRIVACY_PRESIDIO_TIMEOUT_MS,
    }),
    model: PiiRedactionModelService.create({
      model: modelService(single.channel),
      split: split ? modelService(splitModel.channel) : undefined,
      splitSlots: slots,
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      scopes: DataPrivacyProjectScopeService.create({
        repository: MemoryDataPrivacyProjectScopeRepository.create({
          projects: [dataPrivacyTestPlacement()],
        }),
      }),
      selfHosted: false,
      entitlements: createApiFixture<EntitlementApi>({}),
      spend: PiiRedactionSpendService.create({
        selfHosted: false,
        requestIdKey: KEY,
        featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
        recordSpendPriced: async (fact) => {
          priced.push(fact);
        },
      }),
      metrics: { modelFellBack: (reason) => fallbacks.push(reason) },
      log: {
        info: (fields) => usage.push(fields),
        warn: (fields) => usage.push(fields),
      },
      now: () => Date.now(),
    }),
    dlp: GoogleDlpRedactionService.create({
      dlp: MemoryGoogleDlpChannel.create(),
      disabled: false,
      metrics,
    }),
  });

  const clear = (
    texts: string[],
    extra: { spareNamesAndPlaces?: boolean[]; recordKey?: string } = {},
  ) =>
    analysis.clearPresidio({
      texts,
      piiRedactionLevel: "STRICT",
      effectivePiiLevel: "strict",
      projectId: PROJECT_ID,
      ...extra,
    });
  const presidioCalls = () => presidio.batches.filter((batch) => batch.texts.length > 0);

  return { clear, presidio, presidioCalls, single, splitModel, fallbacks, usage, priced };
}

/** Lets every settled promise run its callbacks, without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => {
  vi.useRealTimers();
});

/** Where each call's texts sit in `text`: every sent piece located, in order. */
function piecesOf({ text, calls }: { text: string; calls: readonly string[][] }) {
  return calls.flat().map((piece) => {
    const start = text.indexOf(piece);
    return { start, end: start + piece.length };
  });
}

describe("PiiRedactionModelService, a long batch with a split model set (ADR-207)", () => {
  /** @scenario "With a split model set, a long batch is split across model calls and masked where the model found it" */
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

  /** @scenario "A batch over 32,000 characters skips the model even with a split model set" */
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
    const { clear, presidio, presidioCalls, splitModel } = setup({
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
    const { clear, presidio } = setup({ planted, turns: Array<FakeTurn>(8).fill("lie") });
    presidio.answerWith(presidioAnswer(1));

    expect(await clear([text])).toEqual([PRESIDIO_MASK]);
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

  /** @scenario "One failed split call sends the whole span to Presidio and nothing is stored unmasked" */
  it("answers from Presidio at once when one call fails while the other is still running", async () => {
    const { clear, presidio, splitModel } = setup({ turns: ["hold", "fail"] });
    presidio.answerWith(presidioAnswer(1));

    const cleared = await clear([filler(12_000)]);

    expect(cleared).toEqual([PRESIDIO_MASK]);
    expect(splitModel.inFlight()).toBe(1);
    splitModel.held[0]?.release();
  });

  /** @scenario "With no free split slot, a long batch goes to Presidio at once as busy" */
  it("sends a long batch to Presidio without waiting when both slots are taken", async () => {
    vi.useFakeTimers();
    const { clear, presidio, splitModel, usage } = setup({ turns: ["hold", "hold"] });
    const holding = clear([filler(12_000)]);
    holding.catch(() => void 0);
    await flush();
    presidio.answerWith(presidioAnswer(1));

    const cleared = await clear([filler(9_000)]);

    expect(cleared).toEqual([PRESIDIO_MASK]);
    expect(usage.map((line) => line.outcome)).toEqual(["busy"]);
    expect(splitModel.inFlight()).toBe(2);
    while (splitModel.held.length > 0) splitModel.held.shift()?.release();
    await flush();
    await holding;
  });

  /** @scenario "A split span runs two calls at once and its later pieces on the slots it holds" */
  it("runs two calls at once and sends each planned piece exactly once", async () => {
    vi.useFakeTimers();
    const text = filler(18_000);
    const { clear, splitModel } = setup({ turns: Array<FakeTurn>(8).fill("hold") });
    const clearing = clear([text]);
    await flush();

    while (splitModel.held.length > 0) {
      expect(splitModel.inFlight()).toBeLessThanOrEqual(2);
      splitModel.held.shift()?.release();
      await flush();
    }
    await clearing;

    expect(splitModel.maxInFlight()).toBe(2);
    expect(splitModel.calls).toEqual(
      planSpanCalls([text]).map((call) => call.pieces.map((p) => text.slice(p.start, p.end))),
    );
  });

  /** @scenario "A split span runs two calls at once and its later pieces on the slots it holds" */
  it("runs its pieces one after another on one free slot, and makes no call when they cannot fit", async () => {
    vi.useFakeTimers();
    const slots = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueued: 0 });
    let freeTheSlot: () => void = () => undefined;
    const taken = slots.run({ task: () => new Promise<void>((done) => (freeTheSlot = done)) });
    const { clear, presidio, splitModel, usage } = setup({
      slots,
      turns: Array<FakeTurn>(4).fill("hold"),
    });
    const long = filler(8_001);
    const clearing = clear([long]);
    await flush();

    while (splitModel.held.length > 0) {
      expect(splitModel.inFlight()).toBe(1);
      splitModel.held.shift()?.release();
      await flush();
    }
    await clearing;
    expect(splitModel.maxInFlight()).toBe(1);
    expect(splitModel.calls).toEqual(
      planSpanCalls([long]).map((call) => call.pieces.map((p) => long.slice(p.start, p.end))),
    );

    const callsBefore = splitModel.calls.length;
    presidio.answerWith(presidioAnswer(1));
    expect(await clear([filler(32_000)])).toEqual([PRESIDIO_MASK]);
    expect(splitModel.calls).toHaveLength(callsBefore);
    expect(usage.at(-1)?.outcome).toBe("busy");
    freeTheSlot();
    await taken;
  });

  /** @scenario "An aborted split call holds its slot until the model's own deadline has passed" */
  it("counts an aborted call's slot as taken until 60 seconds after it started", async () => {
    vi.useFakeTimers();
    const slots = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueued: 0 });
    const { clear, presidio } = setup({ slots, turns: ["hold", { slowMs: 30_000 }, "hold"] });
    presidio.answerWith(presidioAnswer(1));
    const clearing = clear([filler(8_001)]);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(await clearing).toEqual([PRESIDIO_MASK]);
    expect(slots.stats().inFlight).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(slots.stats().inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(slots.stats().inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(slots.stats().inFlight).toBe(0);
  });

  /** @scenario "A split span gets 50 seconds for all its calls, then goes to Presidio" */
  it("falls back as timeout 50 seconds after the span's first call, its second wave included", async () => {
    vi.useFakeTimers();
    const { clear, presidio, presidioCalls, usage, splitModel } = setup({
      turns: [{ slowMs: 30_000 }, { slowMs: 30_000 }, "hold", "hold"],
    });
    presidio.answerWith(presidioAnswer(1));
    const clearing = clear([filler(12_000)]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(splitModel.held).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(presidioCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(await clearing).toEqual([PRESIDIO_MASK]);
    expect(usage.map((line) => line.outcome)).toEqual(["timeout"]);
  });

  /** @scenario "A split call's timeout or throttle never stops short batches reaching the model" */
  it.each([
    { cause: "throttle", turns: ["throttle", "answer"] as FakeTurn[], opensAtMs: 0 },
    { cause: "timeout", turns: ["hold", "hold"] as FakeTurn[], opensAtMs: 50_000 },
  ])(
    "keeps short batches on the model for two minutes after a split $cause",
    async ({ turns, opensAtMs }) => {
      vi.useFakeTimers();
      const { clear, presidio, single, splitModel, fallbacks } = setup({ turns });
      presidio.answerWith(presidioAnswer(1));
      const first = clear([filler(9_000)]);
      await vi.advanceTimersByTimeAsync(opensAtMs);
      await first;
      const splitCalls = splitModel.calls.length;

      await clear([filler(2_000)]);
      expect(single.calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS - 1);
      presidio.answerWith(presidioAnswer(1));
      await clear([filler(9_000)]);
      expect(splitModel.calls).toHaveLength(splitCalls);
      expect(fallbacks.at(-1)).toBe("breaker_open");

      await vi.advanceTimersByTimeAsync(1);
      await clear([filler(9_000)]);
      expect(splitModel.calls.length).toBeGreaterThan(splitCalls);
    },
  );

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
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ characters: 20_000, priceNanoUsd: 20_000 * 500 });
    expect(priced[0]?.costNanoUsd).toBe(
      made.reduce((total, durationMs) => total + piiRedactionCostNanoUsd({ durationMs }), 0),
    );
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

    expect(priced).toHaveLength(1);
    expect(priced[0]?.characters).toBe(32_000);
    expect(splitModel.calls).toHaveLength(splitCalls);
    expect(single.calls).toHaveLength(0);
  });
});
