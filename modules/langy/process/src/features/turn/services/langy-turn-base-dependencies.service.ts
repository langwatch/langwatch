import {
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
    /** An unattended turn is handed no GitHub token. */
    unattended?: boolean;
  }): ReturnType<LangyTurnBaseDependenciesService["enrich"]> {
    await this.refuseOnAggregate(input);
    const results = await this.read(input);
    const resolved = this.requireResolved(input.projectId, results);

    return this.enrich(input, resolved);
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

  private read(input: Parameters<LangyTurnBaseDependenciesService["resolve"]>[0]) {
    const {
      deps,
      projectId,
      userId,
      session,
      requestedConversationId,
      adoptConversationId,
      modelOverride,
      unattended,
    } = input;

    return Promise.allSettled([
      deps.conversations.ensureConversation({
        projectId,
        userId,
        conversationId: requestedConversationId,
        ...(adoptConversationId ? { adoptUnknownId: true } : {}),
      }),
      modelOverride ? Promise.resolve(null) : deps.models.resolve({ projectId }),
      deps.credentials.getOrProvision({
        projectId,
        session,
        mintSessionKey: false,
        ...(unattended ? { mintGithubToken: false } : {}),
      }),
      deps.credentials.findEgressAllowlist({ projectId }),
      deps.credentials.resolveMirrorTier({ projectId }),
    ]);
  }

  private requireResolved(
    projectId: string,
    [conversation, model, credentials, egress, mirror]: Awaited<
      ReturnType<LangyTurnBaseDependenciesService["read"]>
    >,
  ) {
    if (conversation.status === "rejected") {
      throw conversation.reason;
    }

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
      conversation: conversation.value,
      model: model.value,
      credentials: credentials.value,
      egress: egress.value,
      mirror,
    };
  }

  private async enrich(
    input: Parameters<LangyTurnBaseDependenciesService["resolve"]>[0],
    resolved: ReturnType<LangyTurnBaseDependenciesService["requireResolved"]>,
  ) {
    const credentials = resolved.credentials;
    if (resolved.egress) {
      credentials.egressAllowlist = resolved.egress;
    }

    credentials.mirrorTier =
      resolved.mirror.status === "fulfilled" ? resolved.mirror.value : "skip";
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
    };
  }
}
