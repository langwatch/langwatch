/**
 * `LangyApp`'s own producer-only registration of the `langy_conversation_processing`
 * pipeline, and the {@link LangyConversationCommands} dispatcher this module builds
 * over it — porting the deleted hand composition's LANGY third (`git show
 * b383462d96^:apps/api/src/app/api-agent-pipelines.composition.ts`) into the
 * module's own vocabulary. Registering here — inside the module that reads
 * `eventing` — rather than in a process composition root is the whole point of
 * the App declaring `reads(...)`.
 *
 * A process with no `eventing` member refuses AT BOOT, naming "eventing":
 * `LangyApp.reads` makes that member a hard dependency, so the deleted
 * composition's per-write "no queue" refusal (`unqueuedLangyConversationCommands`)
 * is not ported — there is no route to construct this class without one.
 */
import type { EventSourcing } from "@langwatch/eventing";
import { RedisLangyConversationProducerRepository } from "../repositories/redis/redis.langy-conversation-producer.repository.ts";
import { LangyConversationCommands } from "./langy.members.ts";

const LANGY_CONVERSATION_PIPELINE_NAME = "langy_conversation_processing";

/** The one shape a command dispatcher has, checked rather than asserted. */
type LangyCommandSender = { send(data: unknown): Promise<unknown> };

const isSender = (value: unknown): value is LangyCommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LangyCommandSender).send === "function";

/**
 * All twenty-two conversation writes, listed once. A list rather than a
 * trusted read of whatever the registration happened to expose, so a command
 * REMOVED from the packaged definition fails this process's boot rather than
 * one person's turn.
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
] as const satisfies ReadonlyArray<keyof LangyConversationCommands>;

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
