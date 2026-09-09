/**
 * Unit coverage for the puller framework's NormalizedPullEvent → OCSF row
 * mapping. The full effect shape (Prisma + CH + process outbox) is exercised
 * by the integration tier; this file covers the pure mapping the worker calls
 * (eventId composition, raw_event preservation, time-coercion fallback, and
 * which actor field a provider's actor string lands in).
 *
 * The real `mapToOcsfRow` is imported, not re-implemented: an earlier version
 * of this file kept a hand-copied "semantic contract" beside the worker's
 * mapper, which passed happily while the mapper itself put opaque ids in the
 * email column.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { describe, expect, it } from "vitest";

import { mapToOcsfRow, ocsfActorFields } from "../ocsfPullEventMapping";
import type { NormalizedPullEvent } from "../pullerAdapter";

const baseEvent: NormalizedPullEvent = {
  source_event_id: "evt-123",
  event_timestamp: "2026-05-03T10:00:00Z",
  actor: "alice@acme.test",
  action: "completion",
  target: "gpt-5-mini",
  cost_usd: "0.0023",
  tokens_input: 50,
  tokens_output: 12,
  raw_payload: '{"id":"evt-123","raw":"data"}',
};

function mapEvent(event: NormalizedPullEvent) {
  return mapToOcsfRow({
    event,
    tenantId: "gov-proj-1",
    ingestionSourceId: "src-1",
    sourceType: "copilot_studio",
  });
}

function actorOf(rawOcsfJson: string): {
  user: { uid: string; email_addr: string };
} {
  return (
    JSON.parse(rawOcsfJson) as {
      actor: { user: { uid: string; email_addr: string } };
    }
  ).actor;
}

describe("given a pulled provider event", () => {
  describe("when the worker maps it to an OCSF audit row", () => {
    it("composes eventId as `<sourceType>:<sourceId>:<source_event_id>`", () => {
      const row = mapEvent(baseEvent);

      expect(row.eventId).toBe("copilot_studio:src-1:evt-123");
      expect(row.traceId).toBe("pull:copilot_studio:src-1:evt-123");
    });

    it("uses the org's hidden governance project id as tenantId", () => {
      // Same key the trace-fold subscriber + OCSF export service use, so pull
      // events surface alongside trace-derived events on the SIEM export path.
      const row = mapToOcsfRow({
        event: baseEvent,
        tenantId: "gov-proj-acme-42",
        ingestionSourceId: "src-1",
        sourceType: "copilot_studio",
      });

      expect(row.tenantId).toBe("gov-proj-acme-42");
    });

    it("carries action and target through without transformation", () => {
      const row = mapEvent(baseEvent);

      expect(row.actionName).toBe("completion");
      expect(row.targetName).toBe("gpt-5-mini");
    });

    it("preserves the provider's raw payload under the OCSF extension", () => {
      const row = mapEvent(baseEvent);
      const extension = (
        JSON.parse(row.rawOcsfJson) as {
          metadata: { extension: { raw_event: string } };
        }
      ).metadata.extension;

      expect(extension.raw_event).toBe('{"id":"evt-123","raw":"data"}');
    });
  });

  describe("when event_timestamp is unparseable", () => {
    it("falls back to a usable time rather than an invalid date", () => {
      const row = mapEvent({ ...baseEvent, event_timestamp: "not-a-date" });

      expect(row.eventTime).toBeInstanceOf(Date);
      expect(Number.isFinite(row.eventTime.getTime())).toBe(true);
    });
  });
});

describe("given a provider that names the actor by an address", () => {
  describe("when the row is mapped", () => {
    it("records the address verbatim in the actor email field", () => {
      const row = mapEvent(baseEvent);

      expect(row.actorEmail).toBe("alice@acme.test");
      expect(row.actorUserId).toBe("");
      expect(actorOf(row.rawOcsfJson).user).toEqual({
        uid: "",
        email_addr: "alice@acme.test",
      });
    });

    it("keeps the provider's own casing rather than normalizing it", () => {
      // An audit row states what the provider said. Matching is where an
      // address gets lowercased, and it does its own normalizing.
      const row = mapEvent({ ...baseEvent, actor: "M.Silva@Acme.test" });

      expect(row.actorEmail).toBe("M.Silva@Acme.test");
    });
  });
});

describe("given a provider that names the actor by an opaque id", () => {
  describe("when the row is mapped", () => {
    it("keeps the id out of the actor email field", () => {
      // The OpenAI cost report names a person only by `user-…` and sends no
      // address at all. An id in an email-named column is not proof of an
      // address, and the SIEM export ships that column to customer tooling.
      const row = mapEvent({ ...baseEvent, actor: "user-A1b2C3d4E5" });

      expect(row.actorEmail).toBe("");
      expect(row.actorUserId).toBe("user-A1b2C3d4E5");
      expect(actorOf(row.rawOcsfJson).user).toEqual({
        uid: "user-A1b2C3d4E5",
        email_addr: "",
      });
    });

    it("keeps a directory GUID out of the actor email field too", () => {
      const row = mapEvent({
        ...baseEvent,
        actor: "11111111-2222-3333-4444-555555555555",
      });

      expect(row.actorEmail).toBe("");
      expect(row.actorUserId).toBe("11111111-2222-3333-4444-555555555555");
    });
  });
});

describe("given a provider that names nobody", () => {
  describe("when the row is mapped", () => {
    it("leaves every actor field blank", () => {
      const row = mapEvent({ ...baseEvent, actor: "" });

      expect(row.actorEmail).toBe("");
      expect(row.actorUserId).toBe("");
      expect(row.actorEnduserId).toBe("");
    });
  });
});

describe("given the actor-field placement rule on its own", () => {
  describe("when it is handed strings adapters actually emit", () => {
    it("routes addresses to email and everything else to the user id", () => {
      expect(ocsfActorFields("dana.hoffman@acme.test")).toEqual({
        actorEmail: "dana.hoffman@acme.test",
        actorUserId: "",
      });
      // A user principal name is address-shaped and reaches us as one.
      expect(ocsfActorFields("dana@acme.onmicrosoft.test")).toEqual({
        actorEmail: "dana@acme.onmicrosoft.test",
        actorUserId: "",
      });
      // Not addresses, however much they look like identifiers of people.
      expect(ocsfActorFields("user-A1b2C3d4E5")).toEqual({
        actorEmail: "",
        actorUserId: "user-A1b2C3d4E5",
      });
      expect(ocsfActorFields("Dana Hoffman")).toEqual({
        actorEmail: "",
        actorUserId: "Dana Hoffman",
      });
      expect(ocsfActorFields("Dana Hoffman <dana@acme.test>")).toEqual({
        actorEmail: "",
        actorUserId: "Dana Hoffman <dana@acme.test>",
      });
    });
  });
});
