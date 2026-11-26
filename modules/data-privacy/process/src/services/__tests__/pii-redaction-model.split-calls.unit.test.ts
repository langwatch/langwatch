import { ConcurrencyLimiter } from "@langwatch/limiter";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS } from "../../rules/pii-redaction-model.rules.ts";
import {
  PRESIDIO_MASK,
  presidioAnswer,
  planSpanCalls,
  setup,
  flush,
} from "./pii-redaction-model.split-setup.fixture.ts";
import { type FakeTurn, filler } from "./pii-redaction-split.fixture.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("PiiRedactionModelService, running a split span's calls (ADR-207)", () => {
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

  /** @scenario "A split call's timeout or throttle never stops short batches reaching the model" */
  it("opens the split breaker on a throttle that lands after the span already went to Presidio", async () => {
    const { clear, presidio, splitModel, fallbacks } = setup({ turns: ["hold", "fail"] });
    const texts = [filler(3_000), filler(3_000, 50_000), filler(3_000, 90_000)];
    presidio.answerWith(presidioAnswer(3));
    expect(await clear(texts)).toEqual([PRESIDIO_MASK, PRESIDIO_MASK, PRESIDIO_MASK]);

    splitModel.held[0]?.throttle();
    await Promise.resolve();
    presidio.answerWith(presidioAnswer(3));
    await clear(texts);

    expect(splitModel.calls).toHaveLength(2);
    expect(fallbacks.at(-1)).toBe("breaker_open");
  });

  /** @scenario "A split call's timeout or throttle never stops short batches reaching the model" */
  it("opens the split breaker on a throttle that lands after a sibling call already failed", async () => {
    const { clear, presidio, splitModel, fallbacks } = setup({ turns: ["fail", "throttle"] });
    const texts = [filler(3_000), filler(3_000, 50_000), filler(3_000, 90_000)];
    presidio.answerWith(presidioAnswer(3));
    await clear(texts);
    expect(splitModel.calls).toHaveLength(2);

    presidio.answerWith(presidioAnswer(3));
    await clear(texts);

    expect(splitModel.calls).toHaveLength(2);
    expect(fallbacks.at(-1)).toBe("breaker_open");
  });
});
