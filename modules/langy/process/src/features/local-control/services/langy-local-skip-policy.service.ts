/**
 * The skip choice, re-read against the model that runs the conversation
 * (ADR-129): consent is recorded once but reconciled per-model, so a model the
 * provider no longer allows drops the policy and notifies via a `policy` frame.
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { LangyLocalWorkspaceChannel } from "../../../channels/langy-local-workspace.channel.ts";
import type { LangyLocalPresenceRepository } from "../../../repositories/langy-local-presence.repository.ts";

const logger = createLogger("langwatch:langy:local-control:skip-policy");

/** The model gate, injected so a test needs no provider rows. */
type SkipGate = (args: { projectId: string; model: string }) => Promise<{ allowed: boolean }>;

export class LocalSkipPolicyService {
  private readonly presence: LangyLocalPresenceRepository;
  private readonly workspace: LangyLocalWorkspaceChannel;

  static create({
    presence,
    workspace,
  }: {
    presence: LangyLocalPresenceRepository;
    workspace: LangyLocalWorkspaceChannel;
  }): LocalSkipPolicyService {
    return new LocalSkipPolicyService({ presence, workspace });
  }

  private constructor({
    presence,
    workspace,
  }: {
    presence: LangyLocalPresenceRepository;
    workspace: LangyLocalWorkspaceChannel;
  }) {
    this.presence = presence;
    this.workspace = workspace;
  }

  /**
   * The skip policy of one conversation, with the model applied. Answers the
   * value the caller should use, and revokes the policy when the model behind it
   * lost the right to it.
   */
  async reconcile({
    projectId,
    conversationId,
    model,
    skipGate,
    changePolicy,
  }: {
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
    const skipping = await this.presence.readPolicy(conversationId);
    if (!skipping) return false;

    const decision = model ? await skipGate({ projectId, model }) : null;
    if (decision?.allowed) return true;

    await this.presence.writePolicy({
      conversationId,
      skipPermissions: false,
    });
    await this.workspace.nudge({ conversationId, nudge: { policy: { skipPermissions: false } } });

    // The consent was one person's, so the revocation is recorded against that
    // same person: the folder's record names who approved the share.
    const workspace = await this.presence
      .getByConversationId(conversationId)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
          return null;
        }
        throw error;
      });
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
}
