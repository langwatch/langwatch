/**
 * @vitest-environment node
 *
 * ADR-059's authorization half, end to end across the two paths a member can
 * learn about a conversation: the tenant-wide freshness signal and the
 * authorized catch-up read.
 *
 * Everything load-bearing here is the real thing — the real broadcast
 * subscriber that publishes when Langy records progress, the real
 * `BroadcastService`, the real `langy` tRPC router (its `onConversationUpdate`
 * subscription and its `conversationEventsAfter` query), the real
 * `LangyConversationService`, the real Prisma conversation repository and the
 * real Postgres row whose `(UserId = caller OR IsShared)` clause IS the
 * visibility rule. Only three boundaries are stubbed: the project-permission /
 * rollout middlewares (covered by langyAccessMiddleware.unit.test.ts), the
 * composition root, and the ClickHouse event-log reader.
 *
 * Spec: specs/langy/langy-event-sourced-frontend.feature
 * Requires: PostgreSQL database (Prisma)
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  type LangyEventCursor,
} from "@langwatch/langy";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { appHolder } = vi.hoisted(() => ({
  appHolder: { current: null as unknown },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => appHolder.current,
}));

// The rollout gate and the demo refusal are transport concerns with their own
// unit tests; this file is about who may READ a conversation.
vi.mock("../langyAccessMiddleware", () => ({
  enforceLangyAccess: ({ next }: { next: () => unknown }) => next(),
  refuseDemoProject: ({ next }: { next: () => unknown }) => next(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

import { createInnerTRPCContext } from "../../trpc";
import { prisma } from "~/server/db";
import { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import { LangyConversationService } from "~/server/app-layer/langy/langy-conversation.service";
import { PrismaLangyConversationRepository } from "~/server/app-layer/langy/repositories/langy-conversation.prisma.repository";
import { createLangyConversationUpdateBroadcastSubscriber } from "~/server/app-layer/langy/subscribers/langy-conversation-update-broadcast.subscriber";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import { langyRouter } from "../langy";

const ns = nanoid(8);
const PROJECT_ID = `p-langy-vis-${ns}`;
const OWNER = `alice-${ns}`;
const OTHER_MEMBER = `bob-${ns}`;
const PRIVATE_CONVERSATION = `conv-private-${ns}`;
const SHARED_CONVERSATION = `conv-shared-${ns}`;
const TURN = `turn-${ns}`;

/** Where each conversation's projection stands after Langy recorded progress. */
const PROGRESS_CURSOR: LangyEventCursor = {
  acceptedAt: 2_000,
  eventId: "2Aevt00002",
};
/** Where a client that only saw the turn start still sits. */
const BEHIND_CURSOR: LangyEventCursor = {
  acceptedAt: 1_000,
  eventId: "2Aevt00001",
};

/** The recorded steps of the turn, identical for both conversations. */
const recordedSteps = (
  conversationId: string,
): LangyConversationProcessingEvent[] =>
  [
    {
      id: "2Aevt00001",
      createdAt: 1_000,
      occurredAt: 990,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
      data: { conversationId, turnId: TURN },
    },
    {
      id: PROGRESS_CURSOR.eventId,
      createdAt: PROGRESS_CURSOR.acceptedAt,
      occurredAt: PROGRESS_CURSOR.acceptedAt - 10,
      type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
      data: {
        conversationId,
        turnId: TURN,
        toolCallId: "tc-1",
        toolName: "bash",
        command: "grep traces",
      },
    },
  ].map(
    (step) =>
      ({
        ...step,
        aggregateId: conversationId,
        aggregateType: "langy_conversation",
        tenantId: PROJECT_ID,
      }) as unknown as LangyConversationProcessingEvent,
  );

/** The ClickHouse event-log read, the one boundary this file substitutes. */
const eventsReader = {
  getEventsOccurredSince: async (aggregateId: string) =>
    recordedSteps(aggregateId),
};

/**
 * The narrow Postgres freshness read the production subscriber performs — the
 * same projection row, read for its cursor and its owner/share fields.
 */
const freshnessReader = {
  read: async ({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }) => {
    const row = await prisma.langyConversationProjection.findFirst({
      where: { projectId, ConversationId: conversationId },
    });
    if (!row) return null;
    return {
      cursor: { acceptedAt: row.AcceptedAt, eventId: row.LastEventId },
      ownerUserId: row.UserId,
      isShared: row.IsShared,
    };
  },
};

let broadcast: BroadcastService;
let recordProgress: (conversationId: string) => Promise<void>;

const callerFor = (userId: string) => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId }, expires: "1" } as any,
    permissionChecked: true,
  });
  return langyRouter.createCaller(ctx);
};

/** A member with the panel open: subscribed, waiting on the next signal. */
async function openSession(userId: string) {
  const stream = (await callerFor(userId).onConversationUpdate({
    projectId: PROJECT_ID,
  })) as AsyncGenerator<{ event: string; timestamp: number }>;
  // Drive the generator to its first await so `events.on` has attached before
  // anything is published — a signal emitted earlier would simply be missed.
  const pending = stream.next();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    pending,
    close: () => stream.return(undefined as never),
  };
}

const NOTHING = Symbol("nothing");

async function signalWithin(
  pending: Promise<IteratorResult<{ event: string }>>,
  ms: number,
): Promise<{ conversationId: string; cursor: LangyEventCursor } | typeof NOTHING> {
  const settled = await Promise.race([
    pending,
    new Promise<typeof NOTHING>((resolve) => setTimeout(() => resolve(NOTHING), ms)),
  ]);
  if (settled === NOTHING) return NOTHING;
  return JSON.parse(settled.value.event) as {
    conversationId: string;
    cursor: LangyEventCursor;
  };
}

async function insertConversation({
  conversationId,
  isShared,
}: {
  conversationId: string;
  isShared: boolean;
}) {
  await prisma.langyConversationProjection.create({
    data: {
      projectId: PROJECT_ID,
      ConversationId: conversationId,
      UserId: OWNER,
      TitleSource: "derived",
      Status: "running",
      IsShared: isShared,
      MessageCount: 2,
      CurrentTurnId: TURN,
      LastActivityAt: PROGRESS_CURSOR.acceptedAt,
      CreatedAt: 500,
      UpdatedAt: PROGRESS_CURSOR.acceptedAt,
      OccurredAt: PROGRESS_CURSOR.acceptedAt - 10,
      AcceptedAt: PROGRESS_CURSOR.acceptedAt,
      LastEventId: PROGRESS_CURSOR.eventId,
      ProjectionVersion: "2026-07-10",
    },
  });
}

describe(
  "Langy conversation updates reach exactly the members who may read",
  () => {
    beforeAll(async () => {
      await insertConversation({
        conversationId: PRIVATE_CONVERSATION,
        isShared: false,
      });
      await insertConversation({
        conversationId: SHARED_CONVERSATION,
        isShared: true,
      });

      broadcast = new BroadcastService(null);
      const conversations = new LangyConversationService(
        new PrismaLangyConversationRepository(prisma),
        {} as never,
        undefined,
        eventsReader,
      );
      appHolder.current = { broadcast, langy: { conversations } };

      const subscriber = createLangyConversationUpdateBroadcastSubscriber({
        broadcast,
        conversations: freshnessReader,
      });
      recordProgress = async (conversationId: string) => {
        const progress = recordedSteps(conversationId).at(-1)!;
        await subscriber.handle(progress, {
          tenantId: progress.tenantId,
          aggregateId: String(progress.aggregateId),
        });
      };
    });

    afterAll(async () => {
      await prisma.langyConversationProjection.deleteMany({
        where: { projectId: PROJECT_ID },
      });
      await broadcast?.close();
    });

    describe("given another project member with their own session", () => {
      describe("when Langy records progress on a private conversation", () => {
        /** @scenario A private conversation's updates stay with its owner */
        it("tells the other member nothing and refuses their catch-up fetch as not-found", async () => {
          const owner = await openSession(OWNER);
          const other = await openSession(OTHER_MEMBER);

          try {
            await recordProgress(PRIVATE_CONVERSATION);

            // The control: the signal really was published, so "receives
            // nothing" below is a gate decision and not a silent test.
            const toOwner = await signalWithin(owner.pending, 2_000);
            expect(toOwner).not.toBe(NOTHING);
            expect(toOwner).toMatchObject({
              conversationId: PRIVATE_CONVERSATION,
              cursor: PROGRESS_CURSOR,
            });

            expect(await signalWithin(other.pending, 500)).toBe(NOTHING);

            // Proof that silence was a decision and not a dead stream: the
            // SAME still-open session wakes for the shared conversation, and
            // the private signal it skipped never turns up behind it.
            await recordProgress(SHARED_CONVERSATION);
            expect(await signalWithin(other.pending, 2_000)).toMatchObject({
              conversationId: SHARED_CONVERSATION,
            });
          } finally {
            await owner.close();
            await other.close();
          }

          // ...and the other way in is closed too: the catch-up read refuses
          // with a typed handled error carrying a kind the panel can render,
          // reported as not-found so it cannot double as an existence probe.
          const refusal = callerFor(OTHER_MEMBER).conversationEventsAfter({
            projectId: PROJECT_ID,
            conversationId: PRIVATE_CONVERSATION,
            after: BEHIND_CURSOR,
          });
          await expect(refusal).rejects.toMatchObject({
            code: "NOT_FOUND",
            cause: expect.objectContaining({
              code: "langy_conversation_not_found",
              httpStatus: 404,
            }),
          });

          const forOwner = await callerFor(OWNER).conversationEventsAfter({
            projectId: PROJECT_ID,
            conversationId: PRIVATE_CONVERSATION,
            after: BEHIND_CURSOR,
          });
          expect(forOwner.events.map((event) => event.id)).toEqual([
            PROGRESS_CURSOR.eventId,
          ]);
        });
      });
    });

    describe("given the conversation is shared with the project", () => {
      describe("when Langy records progress while another member has it open", () => {
        /** @scenario A shared conversation updates every member watching it */
        it("signals the other member and serves them the recorded steps they are behind on", async () => {
          const other = await openSession(OTHER_MEMBER);

          try {
            await recordProgress(SHARED_CONVERSATION);

            const signal = await signalWithin(other.pending, 2_000);
            expect(signal).toMatchObject({
              conversationId: SHARED_CONVERSATION,
              cursor: PROGRESS_CURSOR,
            });
          } finally {
            await other.close();
          }

          // The signal is inert on its own — the progress itself arrives by
          // folding the tail after the member's own position, no reload.
          const tail = await callerFor(OTHER_MEMBER).conversationEventsAfter({
            projectId: PROJECT_ID,
            conversationId: SHARED_CONVERSATION,
            after: BEHIND_CURSOR,
          });
          expect(tail.events).toHaveLength(1);
          expect(tail.events[0]).toMatchObject({
            id: PROGRESS_CURSOR.eventId,
            type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
          });
          expect(tail.cursor).toEqual(PROGRESS_CURSOR);
        });
      });
    });
  },
);
