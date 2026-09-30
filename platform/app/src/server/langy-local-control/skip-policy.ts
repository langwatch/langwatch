/**
 * The skip choice, re-read against the model that runs the conversation
 * (ADR-129, "Skipping permission checks is one explicit choice, gated by the
 * model").
 *
 * The developer's consent is recorded once, and the gate behind it is not a
 * fact of that moment: a conversation that moves to another model moves the
 * answer with it. So the policy is reconciled where it is about to matter, on
 * the register that reports it and on the call that would run without a card.
 * A model the provider does not allow drops the policy, tells the command line
 * with a `policy` frame, and records the change.
 */

import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { canModelSkipPermissions } from "~/server/app-layer/langy/langySkipPermissions";
import type { WorkspaceNudge } from "./call.dispatcher";
import { workspaceChannel } from "./keys";
import type { LocalControlRuntime } from "./runtime";

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
  skipGate = canModelSkipPermissions,
  changePolicy,
}: {
  runtime: LocalControlRuntime;
  projectId: string;
  conversationId: string;
  /** The conversation's current model, provider-prefixed. */
  model: string | null;
  skipGate?: SkipGate;
  /** Records the revocation, defaulting to the app's own command. */
  changePolicy?: (args: {
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
    const record =
      changePolicy ??
      (async (args) => {
        await getApp().commands.langy.changeLocalPolicy({
          tenantId: projectId,
          occurredAt: Date.now(),
          ...args,
        });
      });
    await record({
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
