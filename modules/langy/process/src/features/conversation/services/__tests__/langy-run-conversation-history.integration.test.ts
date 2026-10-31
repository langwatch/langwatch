/**
 * @vitest-environment node
 * A run conversation from its turn's command to the person's history: the accept's events,
 * folded by the real fold, stored and listed (modules/langy/specs/langy-unattended-turn.feature).
 */
import { createTenantId, type TenantId } from "@langwatch/eventing";
import type { LangyConversationStateData } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { processingEvent } from "../../../../eventing/__tests__/support/langy-processing-events.ts";
import { LangyConversationStateFoldProjection } from "../../../../eventing/langy-conversation-state.projection.ts";
import type { LangyConversationCommands } from "../../../../eventing/langy-conversation.commands.ts";
import { AcceptAgentTurnCommand } from "../../../../eventing/langy-conversation.intent.ts";
import { MemoryLangyRepositories } from "../../../../repositories/memory/memory.langy.repositories.ts";
import { LangyConversationService } from "../langy-conversation.service.ts";

const PROJECT = "project-1";
const MEMBER = "user-1";
const AT = Date.UTC(2026, 9, 14, 9, 0);
const RUN_TITLE = "Daily insights - Costs - 2026-10-14";

/** No command is sent by a read; any that were would throw by name. */
const noCommands = new Proxy({} as LangyConversationCommands, {
  get: (_target, name) => () => {
    throw new Error(`A history read sent ${String(name)}`);
  },
});

/** The accept an unattended turn sends for a new conversation: a run, titled for the person. */
function acceptUnattendedTurn({ conversationId }: { conversationId: string }) {
  return new AcceptAgentTurnCommand().handle({
    tenantId: PROJECT as TenantId,
    aggregateId: conversationId,
    data: {
      tenantId: PROJECT,
      occurredAt: AT,
      conversationId,
      turnId: `turn-of-${conversationId}`,
      questionParts: [{ type: "text", text: "Read the board." }],
      conversationStart: { userId: MEMBER, title: RUN_TITLE, origin: "run" },
      userMessage: {
        userId: MEMBER,
        messageId: `message-of-${conversationId}`,
        role: "user",
        parts: [{ type: "text", text: "Read the board." }],
        title: null,
      },
    },
  } as never);
}

/** Folds the events with the conversation's own fold and stores the row, as the worker does. */
async function foldAndStore({
  repositories,
  conversationId,
}: {
  repositories: ReturnType<typeof MemoryLangyRepositories.create>;
  conversationId: string;
}) {
  const fold = LangyConversationStateFoldProjection.create({
    store: repositories.conversationState,
  });
  const events = acceptUnattendedTurn({ conversationId }).map(processingEvent);
  const state: LangyConversationStateData = events.reduce(
    (folded, event) => fold.apply(folded, event),
    fold.init(),
  );
  const last = events.at(-1)!;
  await repositories.conversationState.store(
    {
      state,
      cursor: { acceptedAt: last.createdAt, eventId: last.id },
      occurredAt: last.occurredAt,
      createdAt: AT,
      updatedAt: AT,
      version: fold.version,
    },
    { tenantId: createTenantId(PROJECT), aggregateId: conversationId },
  );
}

describe("given an unattended turn started for a member", () => {
  describe("when the member lists their conversations", () => {
    /** @scenario "A run conversation is listed in the person's history" */
    it("lists the run conversation, with origin run and its title", async () => {
      const repositories = MemoryLangyRepositories.create();
      await foldAndStore({ repositories, conversationId: "conversation-run" });
      const history = LangyConversationService.create({
        commands: noCommands,
        repository: repositories.conversations,
      });

      const page = await history.getPage({ projectId: PROJECT, userId: MEMBER });

      expect(
        page.items.map(({ id, origin, title, isOwn }) => ({ id, origin, title, isOwn })),
      ).toEqual([{ id: "conversation-run", origin: "run", title: RUN_TITLE, isOwn: true }]);
    });
  });
});
