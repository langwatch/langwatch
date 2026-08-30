import { LangyFinalPartsService } from "./langy-final-parts.service";
import { LangyTurnStartService } from "./langy-turn-start.service";
import { LangyTurnStopService } from "./langy-turn-stop.service";
import { type LangyTurnServiceDeps, type StartConversationTurnInput } from "./langy-turn.shared";
import { LangyTurnWarmService } from "./langy-turn-warm.service";

export type {
  LangyChatMessageInput,
  LangyTurnServiceDeps,
  LangyTurnTechnicalPorts,
  StartConversationTurnInput,
} from "./langy-turn.shared";
export {
  composeLangyTurnPrompt,
  langyTurnIdentity,
  LANGY_USER_MESSAGE_LABEL,
} from "./langy-turn.shared";

/** The one public Langy turn facade; all workflow collaborators remain private. */
export class LangyTurnService {
  private readonly start: LangyTurnStartService;
  private readonly stop: LangyTurnStopService;
  private readonly warm: LangyTurnWarmService;

  private constructor(deps: LangyTurnServiceDeps) {
    const resolved = {
      ...deps,
      finalParts: deps.finalParts ?? LangyFinalPartsService.create(),
    };
    this.start = LangyTurnStartService.create(resolved);
    this.stop = LangyTurnStopService.create(resolved);
    this.warm = LangyTurnWarmService.create(resolved);
  }

  static create(deps: LangyTurnServiceDeps): LangyTurnService {
    return new LangyTurnService(deps);
  }

  startConversationTurn(
    input: StartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.start.startConversationTurn(input);
  }

  stopTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<void> {
    return this.stop.stopTurn(input);
  }

  warmConversationWorker(input: {
    projectId: string;
    session: StartConversationTurnInput["session"];
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    return this.warm.warmConversationWorker(input);
  }
}
