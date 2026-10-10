import type {
  ElevenLabsConversationChannel,
  ElevenLabsConversationRead,
  ElevenLabsConversationReport,
} from "../elevenlabs-conversation.channel.ts";

/** The vendor's conversations, in memory: an unseeded id is one the vendor never had. */
export class MemoryElevenLabsConversationChannel implements ElevenLabsConversationChannel {
  readonly asked: string[] = [];
  private readonly reports = new Map<string, ElevenLabsConversationReport>();

  private constructor() {}

  static create(): MemoryElevenLabsConversationChannel {
    return new MemoryElevenLabsConversationChannel();
  }

  seedReport({
    conversationId,
    report,
  }: {
    conversationId: string;
    report: ElevenLabsConversationReport;
  }): void {
    this.reports.set(conversationId, report);
  }

  async readConversation(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<ElevenLabsConversationRead> {
    this.asked.push(input.conversationId);
    const report = this.reports.get(input.conversationId);

    return report ? { report, notFound: false } : { notFound: true };
  }
}
