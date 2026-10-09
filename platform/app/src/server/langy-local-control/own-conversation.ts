/**
 * Who may reach a conversation's shared folder (ADR-129).
 *
 * A conversation shared with the project is readable by every member. The
 * folder behind it sits on the machine of the person who owns the
 * conversation, so reading is all a teammate gets: opening a request for the
 * folder, running a call in it, answering one of its cards, changing its
 * policy and closing it all belong to the owner. Both doors into local
 * control, the panel's tRPC router and the worker's HTTP routes, prove the
 * conversation through here so the rule is one rule.
 *
 * Every refusal is the same not-found, whether the conversation is missing,
 * invisible or a teammate's: an id never confirms that it exists, and an edit
 * of a shared conversation already answers this way.
 */
import { getApp } from "~/server/app-layer/app";
import { LangyConversationNotFoundError } from "~/server/app-layer/langy/errors";
import type { ConversationDetail } from "~/server/app-layer/langy/langy-conversation.service";

export interface ConversationScope {
  projectId: string;
  conversationId: string;
  userId: string;
}

/** The conversation, when this person may read it: their own, or a shared one. */
export async function requireVisibleConversation({
  projectId,
  conversationId,
  userId,
}: ConversationScope): Promise<ConversationDetail> {
  const conversation = await getApp().langy.conversations.findByIdVisible({
    id: conversationId,
    projectId,
    userId,
  });
  if (!conversation) throw new LangyConversationNotFoundError(conversationId);
  return conversation;
}

/** The conversation, when it is this person's to act on. */
export async function requireOwnConversation(
  scope: ConversationScope,
): Promise<ConversationDetail> {
  const conversation = await requireVisibleConversation(scope);
  if (!conversation.isOwn) {
    throw new LangyConversationNotFoundError(scope.conversationId);
  }
  return conversation;
}
