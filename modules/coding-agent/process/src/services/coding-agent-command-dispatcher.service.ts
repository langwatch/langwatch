import type {
  ContributeLogFactsCommandData,
  ContributeMetricFactsCommandData,
  ContributeSpanFactsCommandData,
} from "@langwatch/coding-agent-contract";

type CodingAgentCommandSender = { send(data: unknown): Promise<unknown> };

function isSender(value: unknown): value is CodingAgentCommandSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;

  return typeof value.send === "function";
}

/**
 * The session pipeline's own command senders, which exist only once it is
 * registered. A process that hosts no session pipeline refuses by name rather
 * than failing on an undefined sender.
 */
export class CodingAgentCommandDispatcherService {
  #senders: Readonly<Record<string, unknown>> | undefined;

  private constructor() {}

  static create(): CodingAgentCommandDispatcherService {
    return new CodingAgentCommandDispatcherService();
  }

  /** Binds the registered pipeline's senders. Called once, by the eventing module. */
  connect(commands: Readonly<Record<string, unknown>>): void {
    this.#senders = commands;
  }

  async contributeSpanFacts(data: ContributeSpanFactsCommandData): Promise<void> {
    await this.#send("contributeSpanFacts", data);
  }

  async contributeLogFacts(data: ContributeLogFactsCommandData): Promise<void> {
    await this.#send("contributeLogFacts", data);
  }

  async contributeMetricFacts(data: ContributeMetricFactsCommandData): Promise<void> {
    await this.#send("contributeMetricFacts", data);
  }

  async #send(name: string, data: unknown): Promise<void> {
    const sender = this.#senders?.[name];
    if (!isSender(sender)) {
      throw new Error(
        `coding_agent_processing registered no "${name}" sender; this process hosts no coding-agent session pipeline`,
      );
    }

    await sender.send(data);
  }
}
