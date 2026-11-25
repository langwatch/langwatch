/**
 * The audit sink a transport test reads back: it holds what the runtime wrote,
 * and it refuses rather than guessing when a question has no one answer.
 */
import { describe, expect, it } from "vitest";

import { createTestAuditSink } from "../test-audit-sink.ts";

const row = {
  actorId: "user-1",
  action: "api-key.created",
  scope: { tier: "organization", id: "organization-1" },
  params: {},
  resultId: "key-1",
} as const;

describe("given a sink the runtime has written to", () => {
  describe("when one row carries the action asked for", () => {
    it("answers that row", () => {
      const sink = createTestAuditSink();

      sink.record(row);

      expect(sink.only("api-key.created")).toEqual(row);
      expect(sink.rows).toHaveLength(1);
    });
  });

  describe("when no row carries the action asked for", () => {
    it("refuses naming every action it does hold", () => {
      const sink = createTestAuditSink();

      sink.record(row);

      expect(() => sink.only("api-key.deleted")).toThrow(/holds \[api-key.created\]/);
    });
  });

  describe("when two rows carry the same action", () => {
    it("refuses rather than answering the first", () => {
      const sink = createTestAuditSink();

      sink.record(row);
      sink.record(row);

      expect(() => sink.only("api-key.created")).toThrow(/holds 2 rows/);
    });
  });
});
