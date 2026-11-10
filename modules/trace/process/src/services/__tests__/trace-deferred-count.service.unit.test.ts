import type { FacetDescriptor } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceDeferredCountService } from "../trace-deferred-count.service.ts";

const T = new Date("2026-11-10T12:00:01Z").getTime();
const HOUR = 60 * 60 * 1000;

const spanType: FacetDescriptor = {
  key: "spanType",
  kind: "categorical",
  label: "Span type",
  group: "span",
  topValues: [{ value: "llm", count: 3 }],
  totalDistinct: 1,
};

function harness(answer: () => FacetDescriptor[]) {
  const asked: number[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const counts = TraceDeferredCountService.create({
    count: async () => {
      asked.push(asked.length);
      await gate;
      return answer();
    },
  });
  const read = ({ toOffsetMs = 0 }: { toOffsetMs?: number } = {}) =>
    counts.get({
      params: {
        authorization: ownProof({ projectId: "project-deferred-count", now: T }),
        timeRange: { from: T - HOUR + toOffsetMs, to: T + toOffsetMs },
      },
      facetKeys: ["spanType"],
    });
  return { asked, release, read };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TraceDeferredCountService", () => {
  describe("given a count for a window is still running", () => {
    /** @scenario "Repeated REST facet listings share one span type count" */
    it("answers a concurrent read for the same window from that count", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T);
      const { asked, release, read } = harness(() => [spanType]);

      const first = read();
      const second = read({ toOffsetMs: 5_000 });
      release();

      expect(await first).toEqual([spanType]);
      expect(await second).toEqual([spanType]);
      expect(asked).toHaveLength(1);
    });
  });

  describe("given a count answered every asked key", () => {
    /** @scenario "The REST facet listing still counts span type" */
    it("serves a later read from the kept count", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T);
      const { asked, release, read } = harness(() => [spanType]);
      release();

      await read();
      await read();

      expect(asked).toHaveLength(1);
    });
  });

  describe("given a count came back without its key", () => {
    /** @scenario "The REST facet listing still counts span type" */
    it("does not count again until the cooldown passes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T);
      const { asked, release, read } = harness(() => []);
      release();

      expect(await read()).toEqual([]);
      vi.setSystemTime(T + 29_000);
      await read();
      expect(asked).toHaveLength(1);

      vi.setSystemTime(T + 31_000);
      await read();
      expect(asked).toHaveLength(2);
    });
  });
});
