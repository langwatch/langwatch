/**
 * The durability split (ADR-046): tokens, status and progress are live
 * transport only. They travel on the per-turn Redis stream, which carries a
 * TTL, and they never reach the event log, the conversation projection, or the
 * message rows. Only meaningful transitions are durable.
 *
 * @see specs/langy/langy-event-sourced-conversations.feature
 */
/** @vitest-environment node */

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
  LANGY_EPHEMERAL_SIGNAL_TYPES,
  type LangyMessageProjectionRecord,
} from "@langwatch/langy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LANGY_STREAM,
  LANGY_STREAMING,
} from "~/server/app-layer/langy/streaming/langy.streaming.constants";
import {
  type LangyStreamRedis,
  LangyTokenBuffer,
} from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { createTenantId } from "../../../domain/tenantId";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import { LangyConversationStateFoldProjection } from "../projections/langyConversationState.foldProjection";
import { LangyMessageOperationalMapProjection } from "../projections/langyMessageOperational.mapProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";

const CONVERSATION = "conv-1";
const TURN = "turn-1";
const STREAM_KEY = LANGY_STREAM.streamKey(CONVERSATION, TURN);
const ids = { conversationId: CONVERSATION, turnId: TURN };

const EPHEMERAL_TYPES = Object.values(LANGY_EPHEMERAL_SIGNAL_TYPES);

interface RecordedWrite {
  op: "xadd" | "expire" | "set";
  key: string;
  entryType?: string;
  ttl?: number;
}

/** A stream that records which key every write touched, and how. */
function makeRedis(): { redis: LangyStreamRedis; writes: RecordedWrite[] } {
  const writes: RecordedWrite[] = [];
  const redis: LangyStreamRedis = {
    xadd: async (key, ...args) => {
      const payload = String(args[args.length - 1]);
      writes.push({
        op: "xadd",
        key,
        entryType: (JSON.parse(payload) as { type: string }).type,
      });
      return "1-1";
    },
    xrange: async () => [],
    expire: async (key, seconds) => {
      writes.push({ op: "expire", key, ttl: seconds });
      return 1;
    },
    set: async (key) => {
      writes.push({ op: "set", key });
      return "OK";
    },
    get: async () => null,
  };
  return { redis, writes };
}

const fold = new LangyConversationStateFoldProjection({
  store: {
    store: async () => {},
    load: async () => null,
  } satisfies StateProjectionStore<
    ReturnType<LangyConversationStateFoldProjection["init"]>
  >,
});

const messageAppend = vi.fn(async () => {});
const messages = new LangyMessageOperationalMapProjection({
  store: {
    append: messageAppend,
  } as unknown as AppendStore<LangyMessageProjectionRecord>,
});

function messageRecorded(occurredAt: number): LangyConversationProcessingEvent {
  return {
    id: `event-${occurredAt}`,
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: createTenantId("project-1"),
    createdAt: occurredAt,
    occurredAt,
    type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
    data: {
      conversationId: CONVERSATION,
      userId: "alice",
      messageId: "m1",
      role: "user",
      parts: [{ type: "text", text: "why are my traces failing?" }],
    },
  } as unknown as LangyConversationProcessingEvent;
}

describe("the live stream against the durable event log", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    messageAppend.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given an agent turn streaming its answer token by token", () => {
    /** @scenario "Streamed tokens are not events" */
    it("writes 500 tokens to the per-turn stream alone, and none of them durably", async () => {
      const { redis, writes } = makeRedis();
      const buffer = new LangyTokenBuffer({ redis });

      for (let i = 0; i < 500; i++) {
        await buffer.appendChunk({ ...ids, text: `token${i} ` });
      }
      await buffer.flush(ids);

      // Every write the turn made went to the one expiring per-turn stream.
      // The buffer holds no other surface, so no token can reach the log.
      expect(new Set(writes.map((write) => write.key))).toEqual(
        new Set([STREAM_KEY]),
      );
      const entryTypes = writes
        .filter((write) => write.op === "xadd")
        .map((write) => write.entryType);
      expect(entryTypes.length).toBeGreaterThan(0);
      expect(new Set(entryTypes)).toEqual(new Set(["delta"]));
      // Batched, so the stream never carries one entry per token either.
      expect(entryTypes.length).toBeLessThan(500);

      // Only meaningful transitions are durable: the vocabulary has no token,
      // delta, chunk or stream event at all.
      const durable = [
        ...LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
        ...LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
      ];
      for (const word of ["token", "delta", "chunk", "stream"]) {
        expect(durable.filter((type) => type.includes(word))).toEqual([]);
      }
    });
  });

  describe("given an agent turn reporting status and progress while it runs", () => {
    /** @scenario "Status and progress are ephemeral, never durable" */
    it("leaves them on the expiring stream, out of the projection and the message rows", async () => {
      const { redis, writes } = makeRedis();
      const buffer = new LangyTokenBuffer({ redis });

      for (let i = 0; i < 20; i++) {
        await buffer.appendStatus({ ...ids, status: `searching traces ${i}` });
        await buffer.appendProgress({
          ...ids,
          message: "scanning",
          progress: i,
        });
      }
      await buffer.markEnd(ids);

      expect(new Set(writes.map((write) => write.key))).toEqual(
        new Set([STREAM_KEY]),
      );
      // Neither signal has a durable command to be dispatched through, nor an
      // event type to be appended as.
      for (const signal of EPHEMERAL_TYPES) {
        expect(LANGY_CONVERSATION_PROCESSING_EVENT_TYPES).not.toContain(signal);
        expect(LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES).not.toContain(
          signal,
        );
      }

      // Nothing of a signal reaches the conversation projection...
      const afterMessage = fold.apply(fold.init(), messageRecorded(1000));
      let state = afterMessage;
      for (const signal of EPHEMERAL_TYPES) {
        state = fold.apply(state, {
          ...messageRecorded(2000),
          type: signal,
        } as unknown as LangyConversationProcessingEvent);
      }
      expect(state.MessageCount).toBe(afterMessage.MessageCount);
      expect(state.Status).toBe(afterMessage.Status);
      expect(state.LastActivityAt).toBe(afterMessage.LastActivityAt);
      expect(state.LastEventOccurredAt).toBe(afterMessage.LastEventOccurredAt);

      // ...nor the message rows.
      for (const signal of EPHEMERAL_TYPES) {
        expect(messages.eventTypes).not.toContain(signal);
        expect(messages.map({ type: signal })).toBeNull();
      }
      expect(messageAppend).not.toHaveBeenCalled();

      // Residue: the only place a signal ever landed expires on its own.
      const ttls = writes
        .filter((write) => write.op === "expire")
        .map((write) => write.ttl);
      expect(ttls.length).toBeGreaterThan(0);
      expect(new Set(ttls)).toEqual(
        new Set([LANGY_STREAMING.STREAM_TTL_SECONDS]),
      );
    });
  });
});
