/**
 * The langy_conversation_processing pipeline's own command senders. The process registers the
 * pipeline after the app is built (§9), so each write resolves its sender when it is sent.
 */
import type { LangyConversationCommands } from "../app/langy.members.ts";

const LANGY_CONVERSATION_PIPELINE_NAME = "langy_conversation_processing";

/** All twenty-two conversation writes, listed once;
 * a command the registration lost fails the boot. */
const LANGY_CONVERSATION_COMMAND_NAMES = [
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

type LangyCommandSender = { send(data: unknown): Promise<unknown> };

function isSender(value: unknown): value is LangyCommandSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;

  return typeof value.send === "function";
}

/** The dispatcher the app composes with, connected once by the pipeline's eventing module. */
export class LangyConversationCommandSenders implements LangyConversationCommands {
  #senders: ReadonlyMap<string, LangyCommandSender> | undefined;

  private constructor() {}

  static create(): LangyConversationCommandSenders {
    return new LangyConversationCommandSenders();
  }

  /** Binds the registration's senders, refusing the boot when any of the twenty-two is missing. */
  connect(commands: Readonly<Record<string, unknown>>): void {
    const senders = new Map<string, LangyCommandSender>();
    for (const name of LANGY_CONVERSATION_COMMAND_NAMES) {
      const sender = commands[name];
      if (!isSender(sender)) {
        throw new Error(
          `The ${LANGY_CONVERSATION_PIPELINE_NAME} registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
        );
      }
      senders.set(name, sender);
    }
    this.#senders = senders;
  }

  readonly createConversation: LangyConversationCommands["createConversation"] = (data) =>
    this.#send("createConversation", data);
  readonly forkConversation: LangyConversationCommands["forkConversation"] = (data) =>
    this.#send("forkConversation", data);
  readonly recordMessage: LangyConversationCommands["recordMessage"] = (data) =>
    this.#send("recordMessage", data);
  readonly importMessage: LangyConversationCommands["importMessage"] = (data) =>
    this.#send("importMessage", data);
  readonly acceptAgentTurn: LangyConversationCommands["acceptAgentTurn"] = (data) =>
    this.#send("acceptAgentTurn", data);
  readonly initiateToolCall: LangyConversationCommands["initiateToolCall"] = (data) =>
    this.#send("initiateToolCall", data);
  readonly succeedToolCall: LangyConversationCommands["succeedToolCall"] = (data) =>
    this.#send("succeedToolCall", data);
  readonly failToolCall: LangyConversationCommands["failToolCall"] = (data) =>
    this.#send("failToolCall", data);
  readonly updatePlan: LangyConversationCommands["updatePlan"] = (data) =>
    this.#send("updatePlan", data);
  readonly failAgentResponse: LangyConversationCommands["failAgentResponse"] = (data) =>
    this.#send("failAgentResponse", data);
  readonly recordAgentResponse: LangyConversationCommands["recordAgentResponse"] = (data) =>
    this.#send("recordAgentResponse", data);
  readonly archiveConversation: LangyConversationCommands["archiveConversation"] = (data) =>
    this.#send("archiveConversation", data);
  readonly updateConversationMetadata: LangyConversationCommands["updateConversationMetadata"] = (
    data,
  ) => this.#send("updateConversationMetadata", data);
  readonly recordTurnHandoff: LangyConversationCommands["recordTurnHandoff"] = (data) =>
    this.#send("recordTurnHandoff", data);
  readonly consumeTurnHandoff: LangyConversationCommands["consumeTurnHandoff"] = (data) =>
    this.#send("consumeTurnHandoff", data);
  readonly generateConversationTitle: LangyConversationCommands["generateConversationTitle"] = (
    data,
  ) => this.#send("generateConversationTitle", data);
  readonly requestLocalControl: LangyConversationCommands["requestLocalControl"] = (data) =>
    this.#send("requestLocalControl", data);
  readonly connectLocalWorkspace: LangyConversationCommands["connectLocalWorkspace"] = (data) =>
    this.#send("connectLocalWorkspace", data);
  readonly disconnectLocalWorkspace: LangyConversationCommands["disconnectLocalWorkspace"] = (
    data,
  ) => this.#send("disconnectLocalWorkspace", data);
  readonly changeLocalPolicy: LangyConversationCommands["changeLocalPolicy"] = (data) =>
    this.#send("changeLocalPolicy", data);
  readonly startUserWait: LangyConversationCommands["startUserWait"] = (data) =>
    this.#send("startUserWait", data);
  readonly endUserWait: LangyConversationCommands["endUserWait"] = (data) =>
    this.#send("endUserWait", data);

  async #send(name: string, data: unknown): Promise<void> {
    const sender = this.#senders?.get(name);
    if (!sender) {
      throw new Error(
        `The ${LANGY_CONVERSATION_PIPELINE_NAME} pipeline is not registered in this process yet, so "${name}" has no sender.`,
      );
    }
    await sender.send(data);
  }
}
