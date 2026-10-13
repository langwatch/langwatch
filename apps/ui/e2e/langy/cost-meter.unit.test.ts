import { generateText, streamText } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { createCostMeter, type LangyUsage, type LangyUsageReader } from "./cost-meter";

// The SDK's own in-memory model: the meter is tested through the real
// generate and stream paths, no network and no provider. trpc.ts pulls the
// Prisma client in through seed-account.ts; every test injects its reader.
vi.mock("./trpc", () => ({}));

function usage({ input, output }: { input: number; output: number }) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

function fakeModel({ input, output }: { input: number; output: number }) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usage({ input, output }),
      warnings: [],
    }),
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "ok" },
        { type: "text-end", id: "t" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: usage({ input, output }),
        },
      ]),
    }),
  });
}

/** Answers a scripted sequence of totals, one per read. */
function scriptedLangy(totals: LangyUsage[]): LangyUsageReader & { reads: number } {
  const reader = Object.assign(
    async () => {
      const next = totals[reader.reads];
      reader.reads += 1;
      if (!next) throw new Error("gateway summary refused");
      return next;
    },
    { reads: 0 },
  );
  return reader;
}

describe("createCostMeter", () => {
  describe("when a wrapped model generates", () => {
    it("adds the reported tokens to that role's tally", async () => {
      const meter = createCostMeter();
      const judge = meter.wrap(fakeModel({ input: 120, output: 30 }), "judge");

      await generateText({ model: judge, prompt: "grade this" });
      await generateText({ model: judge, prompt: "grade that" });

      expect(meter.tallies()).toEqual({
        judge: { calls: 2, inputTokens: 240, outputTokens: 60 },
      });
    });
  });

  describe("when a wrapped model streams", () => {
    it("counts the usage on the finish part", async () => {
      const meter = createCostMeter();
      const simulator = meter.wrap(fakeModel({ input: 50, output: 7 }), "simulator");

      const result = streamText({ model: simulator, prompt: "say something" });
      await result.consumeStream();

      expect(meter.tallies()).toEqual({
        simulator: { calls: 1, inputTokens: 50, outputTokens: 7 },
      });
    });
  });

  describe("when a run starts", () => {
    it("zeroes the tallies of the run before it", async () => {
      const meter = createCostMeter();
      const judge = meter.wrap(fakeModel({ input: 10, output: 1 }), "judge");
      await generateText({ model: judge, prompt: "first run" });

      await meter.start();

      expect(meter.tallies()).toEqual({});
      expect(await meter.line()).toBe("harness made no model calls; Langy not metered");
    });
  });

  describe("when Langy is watched", () => {
    it("reports the spend between start and line, not the total", async () => {
      const readLangyUsage = scriptedLangy([
        { usd: 1.5, requests: 40 },
        { usd: 1.5321, requests: 43 },
      ]);
      const meter = createCostMeter({ readLangyUsage });
      meter.watchLangy({ organizationId: "org_1" });
      const judge = meter.wrap(fakeModel({ input: 100, output: 20 }), "judge");

      await meter.start();
      await generateText({ model: judge, prompt: "grade" });

      expect(await meter.line()).toBe(
        "judge 1 calls, 100 input and 20 output tokens; Langy $0.0321 over 3 gateway requests",
      );
    });

    it("reads both totals over the same window", async () => {
      const windows: { from: Date; to: Date }[] = [];
      const meter = createCostMeter({
        readLangyUsage: async ({ from, to }) => {
          windows.push({ from, to });
          return { usd: 0, requests: 0 };
        },
      });
      meter.watchLangy({ organizationId: "org_1" });

      await meter.start();
      await meter.line();

      expect(windows).toHaveLength(2);
      expect(windows[1]).toEqual(windows[0]);
    });

    it("says the spend is unavailable rather than failing the run", async () => {
      const meter = createCostMeter({ readLangyUsage: scriptedLangy([]) });
      meter.watchLangy({ organizationId: "org_1" });

      await meter.start();

      expect(await meter.line()).toBe(
        "harness made no model calls; Langy unavailable (gateway summary refused)",
      );
    });
  });
});
