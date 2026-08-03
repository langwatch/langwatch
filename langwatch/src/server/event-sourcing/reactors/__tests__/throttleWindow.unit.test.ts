import { describe, expect, it } from "vitest";
import type { ReactorJobPayload } from "../throttleWindow";
import { throttledPerWindow } from "../throttleWindow";

const makeJobId = (payload: ReactorJobPayload) =>
  `job:${payload.event.tenantId}`;

describe("throttledPerWindow", () => {
  describe("given a window", () => {
    it("delays dispatch by the window so events have something to collapse into", () => {
      expect(throttledPerWindow({ makeJobId, windowMs: 5_000 }).delay).toBe(
        5_000,
      );
    });

    it("defaults the dedup ttl to the window", () => {
      expect(
        throttledPerWindow({ makeJobId, windowMs: 5_000 }).deduplication?.ttlMs,
      ).toBe(5_000);
    });

    describe("when the suppression must outlast the firing delay", () => {
      it("takes an explicit ttl", () => {
        expect(
          throttledPerWindow({
            makeJobId,
            windowMs: 30_000,
            dedupTtlMs: 300_000,
          }).deduplication?.ttlMs,
        ).toBe(300_000);
      });
    });
  });

  describe("given a queue score pinned to the event's own timestamp", () => {
    it("pins the deadline to the event that opened the window", () => {
      // Extending would re-arm the deadline against each newer event, so an
      // aggregate receiving a continuous stream would defer its own job for
      // as long as the stream lasts and the reactor would never fire.
      expect(
        throttledPerWindow({ makeJobId, windowMs: 5_000 }).deduplication
          ?.extend,
      ).toBe(false);
    });

    it("still carries the newest payload when it fires", () => {
      expect(
        throttledPerWindow({ makeJobId, windowMs: 5_000 }).deduplication
          ?.replace,
      ).toBe(true);
    });
  });

  describe("given two layers read the job id independently", () => {
    it("hands both the very same function", () => {
      // The router collapses a coalesced batch by `makeJobId` before staging;
      // the queue squashes by `deduplication.makeId` after. If they ever
      // disagreed, the queue would stage duplicates the collapse believed it
      // had already removed.
      const options = throttledPerWindow({ makeJobId, windowMs: 5_000 });

      expect(options.makeJobId).toBe(options.deduplication?.makeId);
      expect(options.makeJobId).toBe(makeJobId);
    });
  });

  describe("given post-dispatch suppression is not requested", () => {
    it("lets a later trigger open a fresh window", () => {
      // Level-triggered work must converge on the final state: suppressing
      // after dispatch would leave whatever partial state the dispatched job
      // wrote as the last word.
      expect(
        throttledPerWindow({ makeJobId, windowMs: 5_000 }).deduplication
          ?.shouldSurviveDispatch,
      ).toBe(false);
    });
  });

  describe("given post-dispatch suppression is requested", () => {
    it("honors it", () => {
      expect(
        throttledPerWindow({
          makeJobId,
          windowMs: 5_000,
          surviveDispatch: true,
        }).deduplication?.shouldSurviveDispatch,
      ).toBe(true);
    });
  });
});
