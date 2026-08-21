/**
 * @vitest-environment node
 *
 * Unit coverage for the puller worker's NormalizedPullEvent → OCSF row
 * mapping. The full effect shape (Prisma + ClickHouse + process outbox) is
 * exercised by the integration tier; this file covers the pure mapping — id
 * composition, time coercion, and the actor identity ADR-094 added.
 *
 * It CALLS the mapper. It used to re-implement the mapping inline and assert
 * against its own copy, which meant it stayed green through any change to the
 * real one — the worst kind of passing test, since it looks like coverage.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { describe, expect, it } from "vitest";

import type { NormalizedPullEvent } from "../pullerAdapter";
import { mapToOcsfRow } from "../pullerWorker";

const baseEvent: NormalizedPullEvent = {
  source_event_id: "evt-123",
  event_timestamp: "2026-05-03T10:00:00Z",
  actor: "alice@acme.test",
  actor_id: "6f8a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
  actor_kind: "person",
  action: "completion",
  target: "gpt-5-mini",
  cost_usd: "0.0023",
  tokens_input: 50,
  tokens_output: 12,
  raw_payload: '{"id":"evt-123","raw":"data"}',
};

const map = (event: NormalizedPullEvent = baseEvent, sourceType = "x") =>
  mapToOcsfRow({
    event,
    tenantId: "gov-proj-1",
    ingestionSourceId: "src-1",
    sourceType,
  });

const ocsfOf = (row: ReturnType<typeof map>) =>
  JSON.parse(row.rawOcsfJson) as {
    actor: {
      user: { uid: string; email_addr: string; type_id: number; type: string };
    };
  };

describe("the puller worker's OCSF mapping", () => {
  describe("identity", () => {
    it("composes eventId as `<sourceType>:<sourceId>:<source_event_id>`", () => {
      const row = map(baseEvent, "copilot_studio");

      expect(row.eventId).toBe("copilot_studio:src-1:evt-123");
      expect(row.traceId).toBe("pull:copilot_studio:src-1:evt-123");
    });

    it("uses the organization's hidden governance project as tenantId", () => {
      // The same key the trace-fold subscriber and the SIEM export use, so
      // pulled events surface alongside trace-derived ones.
      expect(map().tenantId).toBe("gov-proj-1");
    });
  });

  describe("the actor", () => {
    it("writes the provider's own id into the column reports join on", () => {
      // Empty until ADR-094; a report groups by this, so an unpopulated
      // column means every pulled row is unattributable by omission.
      expect(map().actorUserId).toBe("6f8a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071");
      expect(ocsfOf(map()).actor.user.uid).toBe(
        "6f8a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      );
    });

    it("keeps the email beside it rather than instead of it", () => {
      expect(map().actorEmail).toBe("alice@acme.test");
      expect(ocsfOf(map()).actor.user.email_addr).toBe("alice@acme.test");
    });

    it("stays empty when the provider exposes no id", () => {
      const row = map({ ...baseEvent, actor_id: "" });

      expect(row.actorUserId).toBe("");
    });

    it("carries the adapter's bucket declaration in the OCSF user type", () => {
      expect(ocsfOf(map()).actor.user).toMatchObject({
        type_id: 1,
        type: "person",
      });
      expect(
        ocsfOf(map({ ...baseEvent, actor_kind: "service_principal" })).actor
          .user,
      ).toMatchObject({ type_id: 3, type: "service_principal" });
    });
  });

  describe("re-pulling the same source event", () => {
    it("produces a byte-identical row, so a restatement overwrites cleanly", () => {
      // ADR-088's restatement path re-inserts on the same key and lets the
      // ReplacingMergeTree collapse it. Any nondeterminism here would make a
      // re-pull look like a change.
      const first = map();
      const second = map();

      expect(second.rawOcsfJson).toBe(first.rawOcsfJson);
      expect(second.actorUserId).toBe(first.actorUserId);
      expect(second.eventId).toBe(first.eventId);
    });
  });

  describe("when event_timestamp is unparseable", () => {
    it("falls back to a valid time rather than writing an invalid date", () => {
      const row = map({ ...baseEvent, event_timestamp: "not-a-date" });

      expect(row.eventTime).toBeInstanceOf(Date);
      expect(Number.isFinite(row.eventTime.getTime())).toBe(true);
    });
  });

  describe("action and target", () => {
    it("propagates them untransformed", () => {
      const row = map();

      expect(row.actionName).toBe("completion");
      expect(row.targetName).toBe("gpt-5-mini");
    });
  });
});
