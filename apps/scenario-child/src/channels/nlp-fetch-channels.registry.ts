import { HttpNlpFetchChannel } from "./http/http.nlp-fetch.channel.ts";
import { MemoryNlpFetchChannel } from "./memory/memory.nlp-fetch.channel.ts";

/** The two tiers behind `NlpFetchChannel`. */
export const nlpFetchChannels = {
  live: HttpNlpFetchChannel,
  memory: MemoryNlpFetchChannel,
};
