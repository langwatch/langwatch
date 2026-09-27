import type { FeatureSetup } from "@langwatch/kernel";
import type { MembersRead } from "@langwatch/process-stores/members";
import {
  SampleAgentsApi,
  type HotelBotReply,
  type HotelBotRunInput,
  type SampleAgentsApi as SampleAgentsApiContract,
} from "@langwatch/sample-agents-contract";
import { openAiApiKey } from "@langwatch/secrets";
import { nowInstant } from "@langwatch/time";

import { openAiChatChannels } from "../channels/openai-chat-channels.registry.ts";
import { traceCollectorChannels } from "../channels/trace-collector-channels.registry.ts";
import { HotelBotService } from "../services/hotel-bot.service.ts";

type SampleAgentsMembers = MembersRead<readonly ["logger"]> &
  Readonly<{ publicBaseUrl: string | undefined }>;

type SampleAgentsSetup = FeatureSetup<
  typeof SampleAgentsApp.dependencies,
  SampleAgentsMembers,
  undefined
>;

/** The demo agents behind the sample project; each run lands as traces in the caller's project. */
export class SampleAgentsApp implements SampleAgentsApiContract {
  static readonly contract = SampleAgentsApi;
  static readonly dependencies = {};
  static readonly reads = ["logger", "publicBaseUrl"] as const;
  /** The platform's own OpenAI key pays for the demo conversations, as it did on main. */
  static readonly secrets = { openAi: openAiApiKey } as const;

  readonly #hotelBot: HotelBotService;

  private constructor(hotelBot: HotelBotService) {
    this.#hotelBot = hotelBot;
  }

  static async create({ members, secrets }: SampleAgentsSetup): Promise<SampleAgentsApp> {
    const chat = await secrets.into(SampleAgentsApp.secrets.openAi, (apiKey) =>
      openAiChatChannels.live.create({ apiKey }),
    );
    return new SampleAgentsApp(
      HotelBotService.create({
        chat,
        collector: traceCollectorChannels.live.create({ baseUrl: members.publicBaseUrl }),
        logger: members.logger,
        random: Math.random,
        nowMs: () => nowInstant().epochMilliseconds,
      }),
    );
  }

  runHotelBot(input: HotelBotRunInput): Promise<HotelBotReply> {
    return this.#hotelBot.run(input);
  }
}
