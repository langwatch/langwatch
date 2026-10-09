import type { InsightFiledEventData, InsightReaderEventData } from "@langwatch/insight-contract";

type CommandSender<Input> = { send(input: Input): Promise<unknown> };

type Envelope = { tenantId: string; occurredAt: number };

export type InsightCommandSenders = {
  fileInsight: CommandSender<InsightFiledEventData & Envelope>;
  markInsightSeen: CommandSender<InsightReaderEventData & Envelope>;
  archiveInsight: CommandSender<InsightReaderEventData & Envelope>;
  keepInsight: CommandSender<InsightReaderEventData & Envelope>;
};

/**
 * The insight pipeline's own senders, bound once the process registered it. Every insight
 * write goes through them, so it lands as an event before any row moves.
 */
export class InsightCommandsService {
  #senders: InsightCommandSenders | undefined;

  private constructor() {}

  static create(): InsightCommandsService {
    return new InsightCommandsService();
  }

  connect(senders: InsightCommandSenders): void {
    this.#senders = senders;
  }

  async fileInsight(input: InsightFiledEventData & Envelope): Promise<void> {
    await this.senders().fileInsight.send(input);
  }

  async markInsightSeen(input: InsightReaderEventData & Envelope): Promise<void> {
    await this.senders().markInsightSeen.send(input);
  }

  async archiveInsight(input: InsightReaderEventData & Envelope): Promise<void> {
    await this.senders().archiveInsight.send(input);
  }

  async keepInsight(input: InsightReaderEventData & Envelope): Promise<void> {
    await this.senders().keepInsight.send(input);
  }

  private senders(): InsightCommandSenders {
    if (!this.#senders) throw new Error("Insight commands used before pipeline registration");
    return this.#senders;
  }
}
