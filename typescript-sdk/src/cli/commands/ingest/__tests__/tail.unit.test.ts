import { describe, expect, it } from "vitest";

import { formatEventLine, pickFreshEvents } from "../tail";
import type { ActivityEventDetailRow } from "@/cli/utils/governance/cli-api";

const mkEvent = (
  overrides: Partial<ActivityEventDetailRow>,
): ActivityEventDetailRow => ({
  eventId: "evt-default",
  eventType: "api.call",
  actor: "u@example",
  action: "chat_completion",
  target: "claude-3-5-sonnet",
  costUsd: 0,
  tokensInput: 0,
  tokensOutput: 0,
  eventTimestampIso: "2026-04-27T07:00:00.000Z",
  ingestedAtIso: "2026-04-27T07:00:01.000Z",
  rawPayload: "{}",
  ...overrides,
});

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("pickFreshEvents", () => {
  describe("when next batch contains nothing newer than the cursor", () => {
    it("returns an empty array", () => {
      const next = [
        mkEvent({ eventId: "a", eventTimestampIso: "2026-04-27T07:00:00.000Z" }),
      ];
      const fresh = pickFreshEvents(next, {
        cursorIso: "2026-04-27T08:00:00.000Z",
        seen: new Set(),
      });
      expect(fresh).toEqual([]);
    });
  });

  describe("when next batch contains events strictly after the cursor", () => {
    it("returns them in chronological (oldest-first) order", () => {
      // server returns DESC; the helper must reverse so consumers print
      // chronologically.
      const next = [
        mkEvent({ eventId: "newest", eventTimestampIso: "2026-04-27T08:00:02.000Z" }),
        mkEvent({ eventId: "middle", eventTimestampIso: "2026-04-27T08:00:01.000Z" }),
        mkEvent({ eventId: "oldest", eventTimestampIso: "2026-04-27T08:00:00.000Z" }),
      ];
      const fresh = pickFreshEvents(next, {
        cursorIso: "2026-04-27T07:00:00.000Z",
        seen: new Set(),
      });
      expect(fresh.map((e) => e.eventId)).toEqual(["oldest", "middle", "newest"]);
    });
  });

  describe("when next batch contains an event AT the cursor boundary not yet seen", () => {
    it("includes it (handles same-timestamp burst)", () => {
      const next = [
        mkEvent({ eventId: "boundary-new", eventTimestampIso: "2026-04-27T07:00:00.000Z" }),
      ];
      const fresh = pickFreshEvents(next, {
        cursorIso: "2026-04-27T07:00:00.000Z",
        seen: new Set(["boundary-old"]),
      });
      expect(fresh.map((e) => e.eventId)).toEqual(["boundary-new"]);
    });
  });

  describe("when next batch contains an event AT the cursor boundary already seen", () => {
    it("excludes it (no double-print on poll)", () => {
      const next = [
        mkEvent({ eventId: "already-seen", eventTimestampIso: "2026-04-27T07:00:00.000Z" }),
      ];
      const fresh = pickFreshEvents(next, {
        cursorIso: "2026-04-27T07:00:00.000Z",
        seen: new Set(["already-seen"]),
      });
      expect(fresh).toEqual([]);
    });
  });

  describe("when next batch mixes already-seen + new events at the boundary", () => {
    it("returns only the unseen ones", () => {
      const next = [
        mkEvent({ eventId: "new-1", eventTimestampIso: "2026-04-27T07:00:00.000Z" }),
        mkEvent({ eventId: "seen", eventTimestampIso: "2026-04-27T07:00:00.000Z" }),
        mkEvent({ eventId: "new-2", eventTimestampIso: "2026-04-27T07:00:00.000Z" }),
      ];
      const fresh = pickFreshEvents(next, {
        cursorIso: "2026-04-27T07:00:00.000Z",
        seen: new Set(["seen"]),
      });
      // Order: server DESC → helper reverses → here was [new-1, seen, new-2]
      // descending means new-1 was actually newest in server order; after
      // filtering out 'seen' and reversing, fresh is [new-2, new-1].
      expect(fresh.map((e) => e.eventId)).toEqual(["new-2", "new-1"]);
    });
  });

  describe("when next batch is empty", () => {
    it("returns an empty array", () => {
      const fresh = pickFreshEvents([], {
        cursorIso: "2026-04-27T07:00:00.000Z",
        seen: new Set(),
      });
      expect(fresh).toEqual([]);
    });
  });

  describe("input immutability", () => {
    it("does not mutate the next array (.reverse() must be on a copy)", () => {
      const original = [
        mkEvent({ eventId: "a", eventTimestampIso: "2026-04-27T08:00:01.000Z" }),
        mkEvent({ eventId: "b", eventTimestampIso: "2026-04-27T08:00:00.000Z" }),
      ];
      const snapshot = original.map((e) => e.eventId);
      pickFreshEvents(original, {
        cursorIso: "2026-04-27T07:00:00.000Z",
        seen: new Set(),
      });
      expect(original.map((e) => e.eventId)).toEqual(snapshot);
    });
  });
});

describe("formatEventLine", () => {
  describe("when cost > 0 and tokens > 0", () => {
    it("renders cost with 4-decimal precision and tokens as 'N/M tok'", () => {
      const line = stripAnsi(
        formatEventLine(
          mkEvent({
            costUsd: 0.001234,
            tokensInput: 100,
            tokensOutput: 250,
          }),
        ),
      );
      expect(line).toContain("$0.0012");
      expect(line).toContain("100/250 tok");
    });
  });

  describe("when cost is 0", () => {
    it("suppresses the cost cell entirely (no '$0.0000' clutter)", () => {
      const line = stripAnsi(
        formatEventLine(
          mkEvent({ costUsd: 0, tokensInput: 10, tokensOutput: 20 }),
        ),
      );
      expect(line).not.toContain("$");
      expect(line).toContain("10/20 tok");
    });
  });

  describe("when both token counts are 0", () => {
    it("suppresses the tokens cell entirely", () => {
      const line = stripAnsi(
        formatEventLine(
          mkEvent({ costUsd: 0.5, tokensInput: 0, tokensOutput: 0 }),
        ),
      );
      expect(line).not.toContain("tok");
      expect(line).toContain("$0.5000");
    });
  });

  describe("when cost is 0 and both tokens are 0", () => {
    it("renders only ts + eventType + action → target with no trailing meta", () => {
      const line = stripAnsi(
        formatEventLine(
          mkEvent({
            costUsd: 0,
            tokensInput: 0,
            tokensOutput: 0,
            eventTimestampIso: "2026-04-27T07:11:18.963Z",
            eventType: "api.call",
            action: "chat_completion",
            target: "claude-3-5-sonnet",
          }),
        ),
      );
      expect(line).toContain("2026-04-27T07:11:18.963Z");
      expect(line).toContain("api.call");
      expect(line).toContain("chat_completion → claude-3-5-sonnet");
      expect(line).not.toContain("$");
      expect(line).not.toContain("tok");
    });
  });

  describe("when only one of input / output tokens is non-zero", () => {
    it("still renders the tokens cell (matches the | predicate in the source)", () => {
      const line = stripAnsi(
        formatEventLine(
          mkEvent({
            tokensInput: 100,
            tokensOutput: 0,
          }),
        ),
      );
      expect(line).toContain("100/0 tok");
    });
  });
});
