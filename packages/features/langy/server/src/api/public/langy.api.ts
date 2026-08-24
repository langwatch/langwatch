import {
  langyConversationInputSchema,
  langyConversationListInputSchema,
  langyCredentialInputSchema,
  langyEgressProjectInputSchema,
  langyRelayFrameSchema,
  langySetEgressInputSchema,
  langyTurnInputSchema,
  type LangyConversation,
  type LangyConversationPage,
  type LangyCredential,
  type LangyEgressAllowlist,
  type LangyService,
} from "@langwatch/langy-contract";

/** Transport-neutral public adapter; HTTP/tRPC wrappers should call these methods. */
export class LangyPublicApi {
  private constructor(private readonly service: LangyService) {}
  static create(service: LangyService): LangyPublicApi {
    return new LangyPublicApi(service);
  }

  list(input: unknown): Promise<LangyConversationPage> {
    return this.service.listConversations(
      langyConversationListInputSchema.parse(input),
    );
  }

  get(input: unknown): Promise<LangyConversation> {
    return this.service.getConversation(langyConversationInputSchema.parse(input));
  }

  startTurn(
    input: unknown,
  ): Promise<{ conversation: LangyConversation; turnId: string }> {
    return this.service.startTurn(langyTurnInputSchema.parse(input));
  }

  messages(input: unknown): Promise<readonly unknown[]> {
    return this.service.listMessages(langyConversationInputSchema.parse(input));
  }

  credential(input: unknown): Promise<LangyCredential> {
    return this.service.resolveCredential(langyCredentialInputSchema.parse(input));
  }

  egress(input: unknown): Promise<LangyEgressAllowlist | null> {
    return this.service.tryGetEgressAllowlist(
      langyEgressProjectInputSchema.parse(input),
    );
  }

  setEgress(input: unknown): Promise<LangyEgressAllowlist | null> {
    return this.service.trySetEgressAllowlist(langySetEgressInputSchema.parse(input));
  }

  relay(input: unknown): Promise<void> {
    return this.service.relay(langyRelayFrameSchema.parse(input));
  }
}
