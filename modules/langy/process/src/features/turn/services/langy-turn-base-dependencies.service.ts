import {
  LANGY_CONVERSATION_ORIGIN,
  LangyEgressMisconfiguredError,
  LangyModelNotConfiguredError,
  type LangyCredentialSession,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  AggregateProjectIsReadOnlyError,
  isAggregateProjectKind,
} from "@langwatch/project-contract";

import type { LangyTurnServiceDeps } from "./langy-turn-shared.service.ts";

const logger = createLogger("langwatch:langy:turn-dependencies");

export class LangyTurnBaseDependenciesService {
  private constructor() {}

  static create(): LangyTurnBaseDependenciesService {
    return new LangyTurnBaseDependenciesService();
  }

  async resolve(input: {
    deps: LangyTurnServiceDeps;
    projectId: string;
    userId: string;
    session: LangyCredentialSession;
    requestedConversationId: string | null;
    adoptConversationId?: boolean;
    modelOverride?: string;
    /** A turn nobody is watching; it reads only, like every later turn of its conversation. */
    unattended?: boolean;
  }): ReturnType<LangyTurnBaseDependenciesService["enrich"]> {
    await this.refuseOnAggregate(input);
    const conversation = await input.deps.conversations.ensureConversation({
      projectId: input.projectId,
      userId: input.userId,
      conversationId: input.requestedConversationId,
      ...(input.adoptConversationId ? { adoptUnknownId: true } : {}),
    });
    // Known before any credential is asked for, so a read-only turn never mints a GitHub token.
    const readOnly = await this.isReadOnly(input, conversation);
    const results = await this.read({ ...input, readOnly });
    const resolved = this.requireResolved(input.projectId, results);

    return this.enrich(input, { ...resolved, conversation, readOnly });
  }

  /**
   * Whether the turn keeps the unattended ceiling: it is unattended, or it continues a run
   * conversation, whose history holds trace text nobody vetted. A conversation that can no
   * longer be read is treated as a run's.
   */
  private async isReadOnly(
    {
      deps,
      projectId,
      userId,
      unattended,
    }: Parameters<LangyTurnBaseDependenciesService["resolve"]>[0],
    conversation: { id: string; isNew: boolean },
  ): Promise<boolean> {
    if (unattended) return true;
    if (conversation.isNew) return false;
    const current = await deps.conversations.findByIdVisible({
      id: conversation.id,
      projectId,
      userId,
    });
    return current === null || current.origin === LANGY_CONVERSATION_ORIGIN.RUN;
  }

  /**
   * A turn writes a conversation, resolves a model and mints a key under the
   * project; an aggregate takes none of it (ADR-177 decision 8), so the refusal
   * comes first rather than whichever lookup fails on an aggregate.
   */
  private async refuseOnAggregate({
    deps,
    projectId,
  }: {
    deps: LangyTurnServiceDeps;
    projectId: string;
  }) {
    const project = await deps.projects.findById(projectId);
    if (isAggregateProjectKind(project?.kind)) throw new AggregateProjectIsReadOnlyError();
  }

  private read(
    input: Parameters<LangyTurnBaseDependenciesService["resolve"]>[0] & { readOnly: boolean },
  ) {
    const { deps, projectId, session, modelOverride, readOnly } = input;

    return Promise.allSettled([
      modelOverride ? Promise.resolve(null) : deps.models.resolve({ projectId }),
      deps.credentials.getOrProvision({
        projectId,
        session,
        mintSessionKey: false,
        ...(readOnly ? { mintGithubToken: false } : {}),
      }),
      deps.credentials.findEgressAllowlist({ projectId }),
      deps.credentials.resolveMirrorTier({ projectId }),
    ]);
  }

  private requireResolved(
    projectId: string,
    [model, credentials, egress, mirror]: Awaited<
      ReturnType<LangyTurnBaseDependenciesService["read"]>
    >,
  ) {
    if (model.status === "rejected") {
      logger.warn({ error: model.reason, projectId }, "getVercelAIModel failed");

      throw new LangyModelNotConfiguredError();
    }

    if (credentials.status === "rejected") {
      throw credentials.reason;
    }

    if (egress.status === "rejected") {
      logger.error(
        { error: egress.reason, projectId },
        "failed to resolve Langy egress allow-list",
      );

      throw new LangyEgressMisconfiguredError();
    }

    return {
      model: model.value,
      credentials: credentials.value,
      egress: egress.value,
      mirror,
    };
  }

  private async enrich(
    input: Parameters<LangyTurnBaseDependenciesService["resolve"]>[0],
    resolved: ReturnType<LangyTurnBaseDependenciesService["requireResolved"]> & {
      conversation: { id: string; isNew: boolean };
      readOnly: boolean;
    },
  ) {
    const credentials = resolved.credentials;
    if (resolved.egress) {
      credentials.egressAllowlist = resolved.egress;
    }

    // A read-only turn reads customer trace text for one person: none of it is copied out.
    credentials.mirrorTier =
      resolved.mirror.status === "fulfilled" && !resolved.readOnly ? resolved.mirror.value : "skip";
    if (resolved.mirror.status === "rejected") {
      logger.warn(
        { error: resolved.mirror.reason, projectId: input.projectId },
        "failed to resolve Langy mirror tier",
      );
    }

    if (input.deps.harness) {
      credentials.harness = await input.deps.harness.resolve({
        userId: input.userId,
        projectId: input.projectId,
        organizationId: credentials.organizationId,
      });
    }

    return {
      speculativeConversation: resolved.conversation,
      credentials,
      resolvedModel: resolved.model?.modelId ?? null,
      readOnly: resolved.readOnly,
    };
  }
}
