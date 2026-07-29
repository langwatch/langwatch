import type { LangyCredentials } from "~/server/app-layer/langy/LangyCredentialService";
import { NullLangyTurnAdmissionRepository } from "~/server/app-layer/langy/repositories/langy-turn-admission.repository";
import type { LangyTurnHandoff } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import type { CommandBus } from "~/server/event-sourcing/commands/commandBus";
import type { ProcessManagerDefinition } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { AppendStore } from "~/server/event-sourcing/projections/mapProjection.types";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";

import { GenerateConversationTitleCommand } from "../../../commands";
import {
  createLangyConversationProcessingPipeline,
  type LangyConversationProcessingPipelineDeps,
} from "../../../pipeline";
import { LANGY_CONVERSATION_PROCESS_NAME } from "../../langyConversationProcess.types";

/**
 * The `langyConversation` process manager exactly as the runtime mounts it.
 *
 * ADR-082: the topology and its effect ports are declared inside
 * `createLangyConversationProcessingPipeline`, so the way to reach the real
 * definition is to build the pipeline. That is stricter than the applier these
 * tests used to import — the effects here are the production
 * `createLangyEffectPorts`, driven through stub collaborators, so the intent
 * executors under test are the ones that run in production rather than
 * recording doubles standing in for them.
 */
export interface LangyEffectCalls {
  /**
   * One per accepted worker dispatch, recorded at the worker boundary.
   *
   * Identities only. `resumeFromTurnId` is deliberately not recorded here:
   * handoff-resume wiring is a property of the intent the handler produces,
   * and `langyConversationProcess.unit.test.ts` asserts it on the dispatch
   * payload itself for both branches (a pending handoff and none). Recording
   * it a second time through the port would test the harness, not the wiring.
   */
  dispatchedTurns: Array<{
    projectId: string;
    conversationId: string;
    turnId: string;
  }>;
  /** One per generated title, recorded where it is written back durably. */
  titleRequests: Array<{
    projectId: string;
    conversationId: string;
    turnId: string;
  }>;
}

const CREDENTIALS: LangyCredentials = {
  llmVirtualKey: "vk-test",
  langwatchEndpoint: "https://app.test",
  gatewayBaseUrl: "https://gateway.test",
  organizationId: "org-test",
  langwatchApiKey: "sk-lw-test",
};

function stateStore<T>(): StateProjectionStore<T> {
  return {
    load: async () => null,
    store: async () => undefined,
  };
}

function appendStore<T>(): AppendStore<T> {
  return { append: async () => undefined };
}

/**
 * Builds the pipeline's process-manager definition over recording
 * collaborators.
 *
 * `projectId` has to be stated because the real dispatch port asserts the
 * stashed handoff belongs to the project the intent names — a guard the old
 * port double had no equivalent of.
 */
export function buildLangyProcessManager({
  projectId,
}: {
  projectId: string;
}): { definition: ProcessManagerDefinition; calls: LangyEffectCalls } {
  const calls: LangyEffectCalls = { dispatchedTurns: [], titleRequests: [] };

  const commands: CommandBus = {
    send: async () => undefined,
    sendBatch: async () => undefined,
    // Keyed on the command's own type string rather than object identity:
    // `command` is generic here, so `===` against one concrete class is not a
    // comparison TypeScript will accept.
    port: (command) => async (data: any) => {
      if (
        command.schema.type !== GenerateConversationTitleCommand.schema.type
      ) {
        return;
      }
      calls.titleRequests.push({
        projectId: data.tenantId,
        conversationId: data.conversationId,
        turnId: data.turnId,
      });
    },
  };

  const deps: LangyConversationProcessingPipelineDeps = {
    langyConversationProjectionStore: stateStore(),
    langyConversationTurnProjectionStore: stateStore(),
    langyMessageProjectionStore: appendStore(),
    langyAnalyticsEventProjectionStore: appendStore(),
    langyTurnAdmissionRepository: new NullLangyTurnAdmissionRepository(),
    tokenBuffer: {
      liveness: async () => ({ present: false, stale: true, lastBeatAt: null }),
      appendStatus: async () => undefined,
      markError: async () => undefined,
    },
    handoffStore: {
      read: async ({ conversationId, turnId }): Promise<LangyTurnHandoff> => ({
        projectId,
        conversationId,
        turnId,
        actorUserId: "user-test",
        prompt: "prompt",
        system: "system",
        credentials: CREDENTIALS,
        runToken: "run-token",
        permitReserved: false,
      }),
      stash: async () => undefined,
    },
    worker: {
      dispatch: async ({ conversationId, turnId }) => {
        calls.dispatchedTurns.push({ projectId, conversationId, turnId });
        return "accepted";
      },
    },
    titleGenerator: async () => ({ title: "A title", model: "gpt-5-mini" }),
    broadcast: { broadcastToTenant: async () => undefined },
    mintSessionKey: async () => ({ token: "sk-lw-minted", apiKeyId: "key-1" }),
    revokeSessionKey: async () => undefined,
    commands,
  };

  const pipeline = createLangyConversationProcessingPipeline(deps);
  const mounted = pipeline.processManagers.get(LANGY_CONVERSATION_PROCESS_NAME);
  if (!mounted) {
    throw new Error("langyConversation process manager is not mounted");
  }
  return { definition: mounted, calls };
}
