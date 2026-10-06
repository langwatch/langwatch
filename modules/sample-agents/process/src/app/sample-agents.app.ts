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

import { openAiChatChannels } from "../channels/openai-chat-channels.registry.ts";
import { traceCollectorChannels } from "../channels/trace-collector-channels.registry.ts";
import { HotelBotService } from "../services/hotel-bot.service.ts";

type SampleAgentsSetup = FeatureSetup<
  typeof SampleAgentsModule.dependencies,
  never,
  SampleAgentsServerConfig
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

  static async create({ config, secrets }: SampleAgentsSetup): Promise<SampleAgentsModule> {
    const chat = await secrets.into(SampleAgentsModule.secrets.openAi, (apiKey) =>
      openAiChatChannels.live.create({ apiKey }),
    );
    return new SampleAgentsModule(
      HotelBotService.create({
        chat,
        collector: traceCollectorChannels.live.create({ baseUrl: config.publicBaseUrl }),
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
