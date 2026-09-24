import { HttpGoogleDlpChannel } from "./http/http.google-dlp.channel.ts";
import { MemoryGoogleDlpChannel } from "./memory/memory.google-dlp.channel.ts";

/** The two tiers behind `GoogleDlpChannel`. */
export const googleDlpChannels = {
  live: HttpGoogleDlpChannel,
  memory: MemoryGoogleDlpChannel,
};
