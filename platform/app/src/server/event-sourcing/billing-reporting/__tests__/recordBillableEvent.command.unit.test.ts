import type { HandlerContext } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  type RecordBillableEventPorts,
  recordBillableEvent,
} from "../recordBillableEvent.command";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const ctx: HandlerContext = { now: 1_000, tenantId: "project-1" };

describe("recordBillableEvent command", () => {
  describe("given the project resolves to an organization", () => {
    it("emits billableEventRecorded stamped with the resolved organization and the project as tenant", async () => {
      const ports: RecordBillableEventPorts = {
        resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
      };

      const events = await recordBillableEvent(ports)(
        {
          id: "event-1",
          type: "lw.obs.trace.span_received",
          createdAt: 1_000,
          idempotencyKey: "idem-1",
        },
        ctx,
      );

      expect(events).toEqual([
        {
          type: "billableEventRecorded",
          data: {
            eventId: "event-1",
            eventType: "lw.obs.trace.span_received",
            organizationId: "org-1",
            tenantId: "project-1",
            deduplicationKey: "idem-1",
            eventTimestamp: 1_000,
          },
        },
      ]);
    });

    it("falls back to the event id when no idempotency key is supplied", async () => {
      const ports: RecordBillableEventPorts = {
        resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
      };

      const events = await recordBillableEvent(ports)(
        { id: "event-1", type: "lw.obs.trace.span_received", createdAt: 1_000 },
        ctx,
      );

      expect(events[0]?.data).toMatchObject({ deduplicationKey: "event-1" });
    });
  });

  describe("given the project has no organization", () => {
    it("emits nothing rather than failing", async () => {
      const ports: RecordBillableEventPorts = {
        resolveOrganizationId: vi.fn().mockResolvedValue(undefined),
      };

      const events = await recordBillableEvent(ports)(
        { id: "event-1", type: "lw.obs.trace.span_received", createdAt: 1_000 },
        ctx,
      );

      expect(events).toEqual([]);
    });
  });
});
