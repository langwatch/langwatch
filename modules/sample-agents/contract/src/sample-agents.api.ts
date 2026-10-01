import { moduleApi } from "@langwatch/module";

import type { HotelBotReply, HotelBotRunInput } from "./hotel-bot.ts";

/** The demo agents a caller runs to see its own project fill with traces. */
export interface SampleAgentsApi {
  runHotelBot(input: HotelBotRunInput): Promise<HotelBotReply>;
}

export const SampleAgentsApi = moduleApi<SampleAgentsApi>()("sample-agents");
