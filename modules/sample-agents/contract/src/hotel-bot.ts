import { z } from "zod";

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
