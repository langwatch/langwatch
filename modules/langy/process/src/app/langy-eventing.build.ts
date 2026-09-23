/**
 * LangyApp eventing: producer-only registration of langy_conversation_processing
 * pipeline and dispatcher. App.reads(eventing) makes it hard dependency (boots
 * refusing without it).
 */
import type { EventSourcing } from "@langwatch/eventing";

import { RedisLangyConversationProducerRepository } from "../repositories/redis/redis.langy-conversation-producer.repository.ts";
import type { LangyConversationCommands } from "./langy.members.ts";

const LANGY_CONVERSATION_PIPELINE_NAME = "langy_conversation_processing";

/** The one shape a command dispatcher has, checked rather than asserted. */
type LangyCommandSender = { send(data: unknown): Promise<unknown> };

const isSender = (value: unknown): value is LangyCommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LangyCommandSender).send === "function";

/**
 * All twenty-two conversation writes, listed once. A list rather than a
 * trusted read of whatever registration exposes, so a command REMOVED
 * from the packaged definition fails this process's boot, not one turn.
 */
const LANGY_COMMAND_NAMES = [
  "createConversation",
  "forkConversation",
  "recordMessage",
  "importMessage",
  "acceptAgentTurn",
  "initiateToolCall",
  "succeedToolCall",
  "failToolCall",
  "updatePlan",
  "failAgentResponse",
  "recordAgentResponse",
  "archiveConversation",
  "updateConversationMetadata",
  "recordTurnHandoff",
  "consumeTurnHandoff",
  "generateConversationTitle",
  "requestLocalControl",
  "connectLocalWorkspace",
  "disconnectLocalWorkspace",
  "changeLocalPolicy",
  "startUserWait",
  "endUserWait",
] as const satisfies readonly (keyof LangyConversationCommands)[];

/** Reads the registration's senders, FAILING AT BOOT for a command it did not produce. */
function resolveSenders(registered: { commands: unknown }): LangyConversationCommands {
  const commands = registered.commands as Record<string, unknown>;
  const resolved: Record<string, (data: unknown) => Promise<void>> = {};
  for (const name of LANGY_COMMAND_NAMES) {
    const sender = commands[name];
    if (!isSender(sender)) {
      throw new Error(
        `The ${LANGY_CONVERSATION_PIPELINE_NAME} registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
      );
    }
    resolved[name] = async (data: unknown) => {
      await sender.send(data);
    };
  }
  return resolved as unknown as LangyConversationCommands;
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
