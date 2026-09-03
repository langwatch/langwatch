import {
  langyConversationInputSchema,
  langyConversationListInputSchema,
  langyCredentialInputSchema,
  langyMessageInputSchema,
  langyRelayFrameSchema,
  langyStopTurnInputSchema,
  langyTurnInputSchema,
  type LangyConversation,
  type LangyConversationInput,
  type LangyConversationListInput,
  type LangyConversationPage,
  type LangyCredential,
  type LangyCredentialInput,
  type LangyMessageInput,
  type LangyRelayFrame,
  type LangyStopTurnInput,
  type LangyTurnInput,
} from "@langwatch/langy-contract";

export type LangyTransport = {
  listConversations(input: LangyConversationListInput): Promise<LangyConversationPage>;
  getConversation(input: LangyConversationInput): Promise<LangyConversation>;
  startTurn(input: LangyTurnInput): Promise<{ conversation: LangyConversation; turnId: string }>;
  listMessages(input: LangyMessageInput): Promise<readonly unknown[]>;
  resolveCredential(input: LangyCredentialInput): Promise<LangyCredential>;
  stopTurn(input: LangyStopTurnInput): Promise<void>;
  relay(frame: LangyRelayFrame): Promise<void>;
};

/** Browser transport facade. Validation stays identical to the server contract. */
export class LangyClient {
  constructor(private readonly transport: LangyTransport) {}

  listConversations(input: LangyConversationListInput): Promise<LangyConversationPage> {
    return this.transport.listConversations(langyConversationListInputSchema.parse(input));
  }

  getConversation(input: LangyConversationInput): Promise<LangyConversation> {
    return this.transport.getConversation(langyConversationInputSchema.parse(input));
  }

  startTurn(input: LangyTurnInput): Promise<{ conversation: LangyConversation; turnId: string }> {
    return this.transport.startTurn(langyTurnInputSchema.parse(input));
  }

  listMessages(input: LangyMessageInput): Promise<readonly unknown[]> {
    return this.transport.listMessages(langyMessageInputSchema.parse(input));
  }

  resolveCredential(input: LangyCredentialInput): Promise<LangyCredential> {
    return this.transport.resolveCredential(langyCredentialInputSchema.parse(input));
  }

  stopTurn(input: LangyStopTurnInput): Promise<void> {
    return this.transport.stopTurn(langyStopTurnInputSchema.parse(input));
  }

  relay(frame: LangyRelayFrame): Promise<void> {
    return this.transport.relay(langyRelayFrameSchema.parse(frame));
  }
}
