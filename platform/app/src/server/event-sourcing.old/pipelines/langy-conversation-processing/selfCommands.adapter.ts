import type { LangyFailTurnCommandPort } from "~/server/app-layer/langy/subscribers";
import type { CommandBus } from "../../commands/commandBus";
import {
  FailAgentResponseCommand,
  GenerateConversationTitleCommand,
} from "./commands";

/**
 * ADR-102. Two of this pipeline's own commands, adapted to the ports
 * the liveness subscriber and the title effect declare.
 *
 * They are its own commands, so this used to need two `Deferred`s resolved
 * after `register()`. The bus resolves by class identity at send time, so
 * binding here — while the pipeline is still being built — is sound and the
 * late binding disappears (ADR-102).
 */
export interface LangySelfCommandPorts {
  failTurn: LangyFailTurnCommandPort;
  saveTitle: (params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    title: string;
    model: string;
  }) => Promise<void>;
}

export function createLangySelfCommandPorts(
  commands: CommandBus,
): LangySelfCommandPorts {
  const failAgentResponse = commands.port(FailAgentResponseCommand);
  const generateConversationTitle = commands.port(
    GenerateConversationTitleCommand,
  );

  return {
    failTurn: {
      failTurn: ({ projectId, conversationId, turnId, error }) =>
        failAgentResponse({
          tenantId: projectId,
          occurredAt: Date.now(),
          conversationId,
          turnId,
          error,
        }),
    },
    saveTitle: ({ projectId, conversationId, turnId, title, model }) =>
      generateConversationTitle({
        tenantId: projectId,
        occurredAt: Date.now(),
        conversationId,
        turnId,
        title,
        source: "auto",
        model,
      }),
  };
}
