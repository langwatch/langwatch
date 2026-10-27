import type { GoogleDlpChannel } from "./google-dlp.channel.ts";
import type { PresidioChannel } from "./presidio.channel.ts";

/** Every channel data-privacy holds, as the container hands them to the module class. */
export interface DataPrivacyChannels {
  readonly presidio: PresidioChannel;
  readonly dlp: GoogleDlpChannel;
}
