import { describe, expect, it } from "vitest";
import {
  frozenAt,
  memoryCache,
  memoryIdempotency,
  memoryObjectStorage,
  memoryRateLimiter,
  recordingMail,
  recordingTelemetry,
} from "../member-doubles.ts";

describe("given a frozen clock", () => {
  describe("when a test moves it", () => {
    it("reads back the moment the test set, and never moves on its own", () => {
      const clock = frozenAt("2026-09-10T12:00:00.000Z");

      expect(clock.now().toISOString()).toBe("2026-09-10T12:00:00.000Z");
      expect(clock.now().toISOString()).toBe("2026-09-10T12:00:00.000Z");

      clock.advance(60_000);
      expect(clock.now().toISOString()).toBe("2026-09-10T12:01:00.000Z");

      clock.set("2020-01-01T00:00:00.000Z");
      expect(clock.now().toISOString()).toBe("2020-01-01T00:00:00.000Z");
    });
  });
});

describe("given the memory object storage", () => {
  describe("when two projects write the same key", () => {
    /** @scenario "Object storage is addressed by project and key together" */
    it("keeps them apart, as the routed member does", async () => {
      const storage = memoryObjectStorage();

      await storage.put({ projectId: "one", key: "report" }, new Uint8Array([1]));
      await storage.put({ projectId: "two", key: "report" }, new Uint8Array([2]));

      await expect(storage.find({ projectId: "one", key: "report" })).resolves.toMatchObject({
        body: new Uint8Array([1]),
      });
      await storage.remove({ projectId: "one", key: "report" });
      await expect(storage.find({ projectId: "one", key: "report" })).resolves.toBeUndefined();
      await expect(storage.find({ projectId: "two", key: "report" })).resolves.toMatchObject({
        body: new Uint8Array([2]),
      });
    });
  });
});

describe("given the memory cache", () => {
  describe("when a tag is invalidated", () => {
    it("drops every entry written under it and leaves the rest", async () => {
      const cache = memoryCache();
      await cache.set("a", "annotations", new Uint8Array([1]), 60);
      await cache.set("b", "annotations", new Uint8Array([2]), 60);
      await cache.set("c", "traces", new Uint8Array([3]), 60);

      await cache.invalidateTag("annotations");

      await expect(cache.find("a")).resolves.toBeUndefined();
      await expect(cache.find("b")).resolves.toBeUndefined();
      await expect(cache.find("c")).resolves.toEqual(new Uint8Array([3]));
    });
  });
});

describe("given the memory idempotency store and rate limiter", () => {
  describe("when the same key is seen twice", () => {
    it("claims once and refuses past the allowance", async () => {
      const idempotency = memoryIdempotency();
      const limiter = memoryRateLimiter(1);

      await expect(idempotency.claim("key", 60)).resolves.toBe(true);
      await expect(idempotency.claim("key", 60)).resolves.toBe(false);
      await expect(limiter.check("key")).resolves.toEqual({ allowed: true });
      await expect(limiter.check("key")).resolves.toMatchObject({ allowed: false });
    });
  });
});

describe("given the recording mail and telemetry doubles", () => {
  describe("when the subject writes to them", () => {
    it("reads the message and the metric back", async () => {
      const mail = recordingMail();
      const telemetry = recordingTelemetry();

      await mail.send({ to: "a@b.test", subject: "hello", html: "<p>hi</p>" });
      telemetry.count("annotations.created");
      telemetry.observe("annotations.duration", 12);

      expect(mail.sent.map((message) => message.to)).toEqual(["a@b.test"]);
      expect(telemetry.counts).toEqual([
        { name: "annotations.created", value: 1, attributes: undefined },
      ]);
      expect(telemetry.observations.map((metric) => metric.value)).toEqual([12]);
    });
  });
});
