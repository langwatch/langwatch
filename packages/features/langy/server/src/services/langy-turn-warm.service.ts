import { stripGithubCredentials } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { LangyTurnBaseDependenciesService } from "./langy-turn-base-dependencies.service";
import { buildWorkerProbeArgs, type LangyTurnServiceDependencies } from "./langy-turn.shared";
import { LangySessionKeyScopeError } from "../ports/langy-turn-runtime.port";

const logger = createLogger("langwatch:langy:turn-warm");

/** Private collaborator for the intentionally best-effort panel-open warm path. */
export class LangyTurnWarmService {
  private constructor(private readonly deps: LangyTurnServiceDependencies) {}

  static create(deps: LangyTurnServiceDependencies): LangyTurnWarmService {
    return new LangyTurnWarmService(deps);
  }

  async warmConversationWorker(args: {
    projectId: string;
    session: { user: { id: string } };
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    const progress: { conversationId: string | null } = { conversationId: null };
    try {
      return await this.resolveAndWarm({ ...args, progress });
    } catch (error) {
      const { projectId } = args;
      if (error instanceof LangySessionKeyScopeError) {
        logger.debug(
          { error, projectId, conversationId: progress.conversationId },
          "langy warm skipped because its session key lacks scope",
        );
      } else {
        logger.warn(
          { error, projectId, conversationId: progress.conversationId },
          "langy warm failed; the first message cold-starts the worker",
        );
      }
      return { conversationId: progress.conversationId, warmed: false };
    }
  }

  private async resolveAndWarm({
    projectId,
    session,
    requestedConversationId,
    modelOverride,
    progress,
  }: {
    projectId: string;
    session: { user: { id: string } };
    requestedConversationId: string | null;
    modelOverride?: string;
    progress: { conversationId: string | null };
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    const { worker } = this.deps;
    const userId = session.user.id;
    const { speculativeConversation, credentials, resolvedModel } =
      await LangyTurnBaseDependenciesService.create().resolve({
        deps: this.deps,
        projectId,
        userId,
        session,
        requestedConversationId,
        ...(requestedConversationId ? { adoptConversationId: true } : {}),
        ...(modelOverride ? { modelOverride } : {}),
      });
    const conversationId = speculativeConversation.id;
    progress.conversationId = conversationId;
    const warmModel = modelOverride ?? resolvedModel;
    if (!worker || !warmModel) {
      return { conversationId, warmed: false };
    }

    const modelsAllowed = await this.deps.credentials.tryGetModelsAllowed({
      projectId,
      organizationId: credentials.organizationId,
    });
    if (modelsAllowed && !modelsAllowed.includes(warmModel)) {
      return { conversationId, warmed: false };
    }
    if (credentials.githubToken) {
      const { allowed } = await this.deps.permits.check({ userId });
      if (!allowed) {
        stripGithubCredentials(credentials);
      }
    }
    const alive = await worker.probe(
      buildWorkerProbeArgs({
        projectId,
        actorUserId: userId,
        conversationId,
        model: warmModel,
        credentials,
      }),
    );
    if (alive) {
      return { conversationId, warmed: true };
    }

    const minted = await this.deps.sessionKeys.mint({
      session,
      projectId,
      organizationId: credentials.organizationId,
    });
    credentials.langwatchApiKey = minted.token;
    credentials.langwatchApiKeyId = minted.apiKeyId;
    void worker
      .warm({
        projectId,
        actorUserId: userId,
        conversationId,
        credentials,
        modelOverride: warmModel,
      })
      .catch((error: unknown) => {
        logger.warn(
          { error, projectId, conversationId },
          "langy warm dispatch failed; the first message cold-starts the worker",
        );
      });
    return { conversationId, warmed: true };
  }
}
