import { describe, expect, it, vi } from "vitest";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createTenantId } from "../../../../domain/tenantId";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  LangyMessageSentEvent,
  LangyTurnFinalizedEvent,
} from "../../schemas/events";
import {
  type ClickHouseLangyMessageRecord,
  LangyMessageStorageMapProjection,
} from "../langyMessageStorage.mapProjection";
import { createLangyMessageAppendStore } from "../langyMessageStorage.store";

const TENANT = createTenantId("project-1");

function messageSentEvent(): LangyMessageSentEvent {
  return {
    id: "e1",
    aggregateId: "conv-1",
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: 1000,
    occurredAt: 1000,
    type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_SENT,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_SENT,
    data: {
      conversationId: "conv-1",
      userId: "alice",
      messageId: "m1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    },
  } as unknown as LangyMessageSentEvent;
}

function turnFinalizedEvent(): LangyTurnFinalizedEvent {
  return {
    id: "e2",
    aggregateId: "conv-1",
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: 2000,
    occurredAt: 2000,
    type: LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TURN_FINALIZED,
    data: {
      conversationId: "conv-1",
      turnId: "turn-1",
      messageId: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "the answer" }],
      outcome: "completed",
    },
  } as unknown as LangyTurnFinalizedEvent;
}

const noopStore = { append: async () => {} };

describe("LangyMessageStorageMapProjection", () => {
  const projection = new LangyMessageStorageMapProjection({ store: noopStore });

  describe("when a user message is mapped", () => {
    it("carries the tenant, message id, role, and serialized parts", () => {
      const record = projection.map(messageSentEvent());
      expect(record).toMatchObject({
        TenantId: "project-1",
        ConversationId: "conv-1",
        MessageId: "m1",
        Role: "user",
        Parts: JSON.stringify([{ type: "text", text: "hello" }]),
      });
    });
  });

  describe("when a finalized turn is mapped", () => {
    it("stores the assistant final answer as one message row", () => {
      const record = projection.map(turnFinalizedEvent());
      expect(record).toMatchObject({
        TenantId: "project-1",
        MessageId: "a1",
        Role: "assistant",
        Parts: JSON.stringify([{ type: "text", text: "the answer" }]),
      });
    });
  });
});

describe("createLangyMessageAppendStore", () => {
  const context: ProjectionStoreContext = {
    aggregateId: "conv-1",
    tenantId: TENANT,
  };

  describe("when the record tenant matches the context", () => {
    it("inserts scoped to the context tenant", async () => {
      const insert = vi.fn();
      const resolveClient = vi.fn(async () => ({ insert }));
      const store = createLangyMessageAppendStore(
        resolveClient as unknown as ClickHouseClientResolver,
      );

      const record: ClickHouseLangyMessageRecord = {
        TenantId: "project-1",
        ConversationId: "conv-1",
        MessageId: "m1",
        Role: "user",
        Parts: "[]",
        CreatedAt: new Date(1000).toISOString(),
        UpdatedAt: new Date(2000).toISOString(),
      };

      await store.append(record, context);

      expect(resolveClient).toHaveBeenCalledWith("project-1");
      expect(insert).toHaveBeenCalledTimes(1);
      const insertArg = insert.mock.calls[0]![0] as {
        table: string;
        values: ClickHouseLangyMessageRecord[];
      };
      expect(insertArg.table).toBe("langy_messages");
      expect(insertArg.values[0]!.TenantId).toBe("project-1");
    });
  });

  describe("when the record tenant does not match the context", () => {
    it("refuses to write cross-tenant", async () => {
      const insert = vi.fn();
      const resolveClient = vi.fn(async () => ({ insert }));
      const store = createLangyMessageAppendStore(
        resolveClient as unknown as ClickHouseClientResolver,
      );

      const foreign: ClickHouseLangyMessageRecord = {
        TenantId: "project-2",
        ConversationId: "conv-1",
        MessageId: "m1",
        Role: "user",
        Parts: "[]",
        CreatedAt: new Date(1000).toISOString(),
        UpdatedAt: new Date(2000).toISOString(),
      };

      await expect(store.append(foreign, context)).rejects.toThrow();
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
