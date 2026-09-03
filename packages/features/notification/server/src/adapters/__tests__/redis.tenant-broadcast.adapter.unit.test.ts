import { describe, expect, it } from "vitest";
import {
  TENANT_BROADCAST_EVENT_TYPES,
  TenantBroadcastPublisherPort,
} from "../../ports/tenant-broadcast.port";
import { RedisTenantBroadcastAdapter } from "../redis.tenant-broadcast.adapter";

/**
 * Spec: packages/features/notification/specs/tenant-broadcast-twin.feature
 *
 * Every expectation below is a LITERAL. Deriving the channel or the body from
 * the module under test would assert only that it agrees with itself, and the
 * thing that breaks is agreement with a subscriber in another process
 * (`platform/app/src/server/app-layer/broadcast/broadcast.service.ts`), which
 * matches the channel by exact string and destructures `{ tenantId, event }`.
 */
class RecordingPublisher extends TenantBroadcastPublisherPort {
  readonly published: Array<{ channel: string; message: string }> = [];

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return 1;
  }
}

class RefusingPublisher extends TenantBroadcastPublisherPort {
  async publish(): Promise<number> {
    throw new Error("READONLY You can't write against a read only replica.");
  }
}

const FROZEN_NOW = 1_756_000_000_000;

function adapterOver(publisher: TenantBroadcastPublisherPort, logger?: unknown) {
  return RedisTenantBroadcastAdapter.createWithClock({
    publisher,
    now: () => FROZEN_NOW,
    ...(logger ? { logger: logger as never } : {}),
  });
}

describe("RedisTenantBroadcastAdapter", () => {
  describe("given a tenant broadcast publisher", () => {
    /** @scenario "The channel is the event type, prefixed" */
    it("publishes on the channel the application subscribes to", async () => {
      const publisher = new RecordingPublisher();

      await adapterOver(publisher).broadcastToTenant({
        tenantId: "project-1",
        event: "{}",
        eventType: "trace_updated",
      });

      expect(publisher.published.map((entry) => entry.channel)).toEqual([
        "broadcast:trace_updated",
      ]);
    });

    /** @scenario "The body is the three fields the subscriber reads" */
    it("publishes the tenant, the event and a timestamp and nothing else", async () => {
      const publisher = new RecordingPublisher();

      await adapterOver(publisher).broadcastToTenant({
        tenantId: "project-1",
        event: '{"e":"C"}',
        eventType: "langy_conversation_updated",
      });

      expect(publisher.published[0]?.message).toBe(
        '{"tenantId":"project-1","event":"{\\"e\\":\\"C\\"}","timestamp":1756000000000}',
      );
      expect(Object.keys(JSON.parse(publisher.published[0]!.message) as object)).toEqual([
        "tenantId",
        "event",
        "timestamp",
      ]);
    });

    /** @scenario "Every channel the application listens on can be published to" */
    it("puts each event type on its own channel", async () => {
      const publisher = new RecordingPublisher();
      const adapter = adapterOver(publisher);

      for (const eventType of TENANT_BROADCAST_EVENT_TYPES) {
        await adapter.broadcastToTenant({ tenantId: "project-1", event: "{}", eventType });
      }

      expect(publisher.published.map((entry) => entry.channel)).toEqual([
        "broadcast:trace_updated",
        "broadcast:simulation_updated",
        "broadcast:export_progress",
        "broadcast:presence_updated",
        "broadcast:presence_cursor",
        "broadcast:discover_updated",
        "broadcast:langy_conversation_updated",
        "broadcast:experiment_updated",
      ]);
    });

    /** @scenario "The producer's payload travels through untouched" */
    it("carries the producer's serialised payload byte for byte", async () => {
      const publisher = new RecordingPublisher();
      const event = '{"e":"TOOL_CALL_ARGS","id":"turn_1","d":"{\\"q\\":1}"}';

      await adapterOver(publisher).broadcastToTenant({
        tenantId: "project-1",
        event,
        eventType: "simulation_updated",
      });

      const body = JSON.parse(publisher.published[0]!.message) as { event: string };
      expect(body.event).toBe(event);
    });
  });

  describe("given a tenant broadcast publisher whose connection refuses", () => {
    /** @scenario "A publish that fails does not fail the work that caused it" */
    it("reports the silence without repeating the tenant's payload", async () => {
      const logged: Array<[Record<string, unknown>, string]> = [];
      const logger = {
        error: (fields: Record<string, unknown>, message: string) => {
          logged.push([fields, message]);
        },
      };

      await expect(
        adapterOver(new RefusingPublisher(), logger).broadcastToTenant({
          tenantId: "project-1",
          event: '{"secret":"do-not-log-me"}',
          eventType: "trace_updated",
        }),
      ).resolves.toBeUndefined();

      expect(logged).toHaveLength(1);
      expect(JSON.stringify(logged[0])).not.toContain("do-not-log-me");
      expect(logged[0]?.[0]).toMatchObject({
        tenantId: "project-1",
        eventType: "trace_updated",
      });
    });
  });
});
