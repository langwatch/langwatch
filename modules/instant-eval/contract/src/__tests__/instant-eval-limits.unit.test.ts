/**
 * The window a reader in another process dates a run's judgements by.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalSkewedWrittenWindow } from "../instant-eval-limits.ts";

describe("given a run read by a process other than the one that judged it", () => {
  const createdAt = Temporal.Instant.from("2026-09-18T10:00:00Z");
  const readAt = Temporal.Instant.from("2026-09-18T12:00:00Z");

  describe("when the window its judgements were written in is read", () => {
    it("widens both ends by an hour so a skewed worker's writes still match", () => {
      const finishedAt = Temporal.Instant.from("2026-09-18T11:00:00Z");

      const window = instantEvalSkewedWrittenWindow({ createdAt, finishedAt }, readAt);

      expect(window.writtenFrom.toString()).toBe("2026-09-18T09:00:00Z");
      expect(window.writtenUntil.toString()).toBe("2026-09-18T12:00:00Z");
    });

    it("ends an hour past the read for a run that has not finished", () => {
      const window = instantEvalSkewedWrittenWindow({ createdAt, finishedAt: null }, readAt);

      expect(window.writtenUntil.toString()).toBe("2026-09-18T13:00:00Z");
    });
  });
});
