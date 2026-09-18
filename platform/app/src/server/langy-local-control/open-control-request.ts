/**
 * Opens a control request for one conversation (ADR-129): the record a
 * terminal approves, and the conversation event that keeps its expiry on the
 * durable log.
 *
 * Two callers open one: the `code_access` tool when Langy asks, and the card's
 * own "Try again" once a request is over. Both go through here so a request
 * opened from the card reaches the terminal, and the log, exactly like the
 * one the tool opened. The caller proves the conversation first.
 */
import { getApp } from "~/server/app-layer/app";
import { SHARE_CONTROL_COMMAND } from "./constants";
import type { StoredControlRequest } from "./control-request.service";
import { getLocalControlRuntime } from "./runtime";
import { conversationTitle, conversationUrl } from "./session.core";

export async function openControlRequest({
  project,
  userId,
  conversation,
}: {
  project: { id: string; name: string; slug: string };
  userId: string;
  conversation: { id: string; title: string | null };
}): Promise<StoredControlRequest> {
  const request = await getLocalControlRuntime().requests.create({
    projectId: project.id,
    projectName: project.name,
    userId,
    conversationId: conversation.id,
    conversationTitle: conversationTitle(conversation.title),
    conversationUrl: conversationUrl(conversation.id, undefined, project.slug),
  });
  await getApp().commands.langy.requestLocalControl({
    tenantId: project.id,
    occurredAt: Date.now(),
    conversationId: conversation.id,
    requestId: request.id,
    userId,
    expiresAt: request.expiresAt,
    command: SHARE_CONTROL_COMMAND,
  });
  return request;
}
