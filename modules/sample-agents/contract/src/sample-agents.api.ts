import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { z } from "zod";

/** The demo agents a caller runs to see its own project fill with traces. */
export interface SampleAgentsApi {
  runHotelBot(input: HotelBotRunInput): Promise<HotelBotReply>;
}

export const SampleAgentsApi = moduleApi<SampleAgentsApi>()("sample-agents");

/** Main's door read no body; a bodiless call arrives as this empty object. */
export const hotelBotRequestSchema = z.object({});

/** The caller's project key, forwarded unread to the collector, which authenticates it. */
export const hotelBotHeadersSchema = z.object({
  "x-auth-token": z.string().optional(),
});

export type HotelBotHeaders = z.infer<typeof hotelBotHeadersSchema>;

export const hotelBotRunInputSchema = z.object({ authToken: z.string().optional() });

export type HotelBotRunInput = z.infer<typeof hotelBotRunInputSchema>;

/** Main's answer: the restaurant conversation also returns the assistant's reply. */
export const hotelBotReplySchema = z.object({
  message: z.literal("Sent to LangWatch"),
  ragResponse: z.string().nullable().optional(),
});

export type HotelBotReply = z.infer<typeof hotelBotReplySchema>;

/** Sample agents' settings: only the shared deployment origin its trace collector posts to. */
export const sampleAgentsConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type SampleAgentsServerConfig = ConfigOf<typeof sampleAgentsConfig>;

/** The demo hotel bot turns away about half its calls on purpose, so the project shows failures. */
export class HotelBotDeclinedError extends HandledError {
  declare readonly code: "demo_bot_declined";

  constructor() {
    super("demo_bot_declined", "The demo bot turned this call away; try again", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "HotelBotDeclinedError";
  }
}
