import type { AgentAdapter } from "@langwatch/scenario";
import { VoiceCallRecordNotReadyError, type CallRecord } from "@langwatch/scenario-contract";

import type {
  VoiceAgentAdapterRequest,
  VoiceSessionConnect,
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.channel.ts";

/** Mints predictable signed URLs and serves the call records a test hands it; places no call. */
export class MemoryVoiceTransportChannel implements VoiceTransportRunner {
  static create(
    records: readonly CallRecord[] = [],
    missingKeyMessage = "No key for this voice transport",
  ): MemoryVoiceTransportChannel {
    return new MemoryVoiceTransportChannel(
      new Map(records.map((record) => [record.conversationId, record])),
      missingKeyMessage,
    );
  }

  readonly minted: { agentId: string }[] = [];
  readonly ended: AgentAdapter[] = [];

  private constructor(
    private readonly records: Map<string, CallRecord>,
    readonly missingKeyMessage: string,
  ) {}

  createAgentAdapter(input: VoiceAgentAdapterRequest): AgentAdapter {
    throw new Error(`A memory voice transport places no live call to ${input.agentId}`);
  }

  mintSession = async (input: {
    agentId: string;
    credential: VoiceTransportCredential;
  }): Promise<VoiceSessionConnect> => {
    this.minted.push({ agentId: input.agentId });
    return { signedUrl: `memory://voice/${encodeURIComponent(input.agentId)}` };
  };

  async getCallRecord(input: {
    conversationId: string;
    credential: VoiceTransportCredential;
    audioProxyUrl: string;
  }): Promise<CallRecord> {
    const record = this.records.get(input.conversationId);
    if (!record) throw new VoiceCallRecordNotReadyError({ conversationId: input.conversationId });
    return record;
  }

  async endCall(adapter: AgentAdapter): Promise<void> {
    this.ended.push(adapter);
  }
}
