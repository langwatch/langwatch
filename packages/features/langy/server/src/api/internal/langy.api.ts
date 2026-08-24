import {
  langyConversationInputSchema,
  langyRelayFrameSchema,
  langyStopTurnInputSchema,
  type LangyService,
} from "@langwatch/langy-contract";

/** Internal/worker adapter. It contains no business logic or persistence access. */
export class LangyInternalApi {
  private constructor(private readonly service: LangyService) {}
  static create(service: LangyService): LangyInternalApi {
    return new LangyInternalApi(service);
  }

  archive(input: unknown): Promise<void> {
    return this.service.archiveConversation(langyConversationInputSchema.parse(input));
  }

  stop(input: unknown): Promise<void> {
    return this.service.stopTurn(langyStopTurnInputSchema.parse(input));
  }

  relay(input: unknown): Promise<void> {
    return this.service.relay(langyRelayFrameSchema.parse(input));
  }
}
