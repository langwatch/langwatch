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

/** The project the API-key door verified, and the key that started the run, which caps it. */
export const hotelBotRunInputSchema = z.object({
  projectId: z.string(),
  startedByApiKeyId: z.string().nullable(),
  startedByUserId: z.string().nullable(),
});

export type HotelBotRunInput = z.infer<typeof hotelBotRunInputSchema>;

/** Main's answer: the restaurant conversation also returns the assistant's reply. */
export const hotelBotReplySchema = z.object({
  message: z.literal("Sent to LangWatch"),
  ragResponse: z.string().nullable().optional(),
});

export type HotelBotReply = z.infer<typeof hotelBotReplySchema>;

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
