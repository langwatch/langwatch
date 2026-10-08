import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import {
  SampleAgentsApi,
  type HotelBotReply,
  type HotelBotRunInput,
  type SampleAgentsApi as SampleAgentsApiContract,
  type SampleAgentsServerConfig,
  sampleAgentsConfig,
} from "@langwatch/sample-agents-contract";
import { openAiApiKey } from "@langwatch/secrets";
import { nowInstant } from "@langwatch/time";

import type { SampleAgentsChannels } from "../channels/sample-agents.channels.ts";
import { HotelBotService } from "../services/hotel-bot.service.ts";

type SampleAgentsSetup = FeatureSetup<
  typeof SampleAgentsModule.dependencies,
  SampleAgentsServerConfig,
  never,
  SampleAgentsChannels
>;

/** The demo agents behind the sample project; each run lands as traces in the caller's project. */
export class SampleAgentsModule implements SampleAgentsApiContract {
  static readonly contract = SampleAgentsApi;
  static readonly dependencies = {};
  static readonly config = sampleAgentsConfig;
  /** The platform's own OpenAI key pays for the demo conversations, as it did on main. */
  static readonly secrets = { openAi: openAiApiKey } as const;

  readonly #hotelBot: HotelBotService;

  private constructor(hotelBot: HotelBotService) {
    this.#hotelBot = hotelBot;
  }

  static async create({ channels }: SampleAgentsSetup): Promise<SampleAgentsModule> {
    return new SampleAgentsModule(
      HotelBotService.create({
        chat: channels.chat,
        collector: channels.collector,
        logger: createLogger("langwatch:sample-agents"),
        random: Math.random,
        nowMs: () => nowInstant().epochMilliseconds,
      }),
    );
  }

  runHotelBot(input: HotelBotRunInput): Promise<HotelBotReply> {
    return this.#hotelBot.run(input);
  }
}
