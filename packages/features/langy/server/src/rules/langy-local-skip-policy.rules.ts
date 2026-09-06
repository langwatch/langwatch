/**
 * The skip choice, re-read against the model that runs the conversation
 * (ADR-129): consent is recorded once but reconciled per-model, so a model the
 * provider no longer allows drops the policy and notifies via a `policy` frame.
 */

import { createLogger } from "@langwatch/observability";
import type { WorkspaceNudge } from "../services/langy-local-call-dispatcher.service.ts";
import { workspaceChannel } from "./langy-local-control-keys.rules.ts";
import type { LocalControlRuntime } from "../adapters/langy-local-control-runtime.adapter.ts";

const logger = createLogger("langwatch:langy:local-control:skip-policy");

/** The model gate, injected so a test needs no provider rows. */
export type SkipGate = (args: {
  projectId: string;
  model: string;
}) => Promise<{ allowed: boolean }>;

/**
 * The skip policy of one conversation, with the model applied. Answers the
 * value the caller should use, and revokes the policy when the model behind it
 * lost the right to it.
 */
export async function reconcileSkipPolicy({
  runtime,
  projectId,
  conversationId,
  model,
  skipGate,
  changePolicy,
}: {
  runtime: LocalControlRuntime;
  projectId: string;
  conversationId: string;
  /** The conversation's current model, provider-prefixed. */
  model: string | null;
  skipGate: SkipGate;
  /** Records the revocation against the person who approved the share. */
  changePolicy: (args: {
    conversationId: string;
    userId: string;
    skipPermissions: boolean;
    model: string;
  }) => Promise<void>;
}): Promise<boolean> {
  const skipping = await runtime.presence.readPolicy(conversationId);
  if (!skipping) return false;

  const decision = model ? await skipGate({ projectId, model }) : null;
  if (decision?.allowed) return true;

  await runtime.presence.writePolicy({
    conversationId,
    skipPermissions: false,
  });
  await runtime.store.publish(
    workspaceChannel(conversationId),
    JSON.stringify({
      policy: { skipPermissions: false },
    } satisfies WorkspaceNudge),
  );

  // The consent was one person's, so the revocation is recorded against that
  // same person: the folder's record names who approved the share.
  const workspace = await runtime.presence.read(conversationId);
  if (workspace) {
    await changePolicy({
      conversationId,
      userId: workspace.userId,
      skipPermissions: false,
      model: model ?? "",
    });
  }
  logger.info(
    { conversationId, model },
    "the conversation's model may not skip permission checks, so the cards are back on",
  );
  return false;
}
