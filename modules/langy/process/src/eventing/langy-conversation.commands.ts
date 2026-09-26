/**
 * LangyApp eventing: producer-only registration of langy_conversation_processing
 * pipeline and dispatcher. App.reads(eventing) makes it hard dependency (boots
 * refusing without it).
 */
import type { EventSourcing } from "@langwatch/eventing";

import type { LangyConversationCommands } from "../app/langy.members.ts";
import { RedisLangyConversationProducerRepository } from "../repositories/redis/redis.langy-conversation-producer.repository.ts";

const LANGY_CONVERSATION_PIPELINE_NAME = "langy_conversation_processing";

/** The one shape a command dispatcher has, checked rather than asserted. */
type LangyCommandSender = { send(data: unknown): Promise<unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSender = (value: unknown): value is LangyCommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LangyCommandSender).send === "function";

/** The registration's sender for one command, FAILING AT BOOT when it produced none. */
function senderFor(commands: unknown, name: keyof LangyConversationCommands) {
  const sender: unknown = isRecord(commands) ? commands[name] : undefined;
  if (!isSender(sender)) {
    throw new Error(
      `The ${LANGY_CONVERSATION_PIPELINE_NAME} registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
    );
  }
  return async (data: unknown): Promise<void> => {
    await sender.send(data);
  };
}

/**
 * All twenty-two conversation writes, listed once. A list rather than a
 * trusted read of whatever registration exposes, so a command REMOVED
 * from the packaged definition fails this process's boot, not one turn.
 */
function resolveSenders(registered: { commands: unknown }): LangyConversationCommands {
  const { commands } = registered;
  return {
    createConversation: senderFor(commands, "createConversation"),
    forkConversation: senderFor(commands, "forkConversation"),
    recordMessage: senderFor(commands, "recordMessage"),
    importMessage: senderFor(commands, "importMessage"),
    acceptAgentTurn: senderFor(commands, "acceptAgentTurn"),
    initiateToolCall: senderFor(commands, "initiateToolCall"),
    succeedToolCall: senderFor(commands, "succeedToolCall"),
    failToolCall: senderFor(commands, "failToolCall"),
    updatePlan: senderFor(commands, "updatePlan"),
    failAgentResponse: senderFor(commands, "failAgentResponse"),
    recordAgentResponse: senderFor(commands, "recordAgentResponse"),
    archiveConversation: senderFor(commands, "archiveConversation"),
    updateConversationMetadata: senderFor(commands, "updateConversationMetadata"),
    recordTurnHandoff: senderFor(commands, "recordTurnHandoff"),
    consumeTurnHandoff: senderFor(commands, "consumeTurnHandoff"),
    generateConversationTitle: senderFor(commands, "generateConversationTitle"),
    requestLocalControl: senderFor(commands, "requestLocalControl"),
    connectLocalWorkspace: senderFor(commands, "connectLocalWorkspace"),
    disconnectLocalWorkspace: senderFor(commands, "disconnectLocalWorkspace"),
    changeLocalPolicy: senderFor(commands, "changeLocalPolicy"),
    startUserWait: senderFor(commands, "startUserWait"),
    endUserWait: senderFor(commands, "endUserWait"),
  };
}

/**
 * This process's own producer-only registration of the langy conversation
 * pipeline, and the dispatcher {@link LangyApp} takes it in as.
 */
export function buildLangyConversationCommands(input: {
  eventing: EventSourcing;
  processName: string;
}): LangyConversationCommands {
  const producer = RedisLangyConversationProducerRepository.create({
    processName: input.processName,
  });
  const registered = input.eventing.register(producer.build());
  return resolveSenders(registered);
}
