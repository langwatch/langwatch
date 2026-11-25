import type { GoogleDlpChannel } from "./google-dlp.channel.ts";
import type { PresidioChannel } from "./presidio.channel.ts";

/** Every channel data-privacy holds, as the container hands them to the module class. */
export interface DataPrivacyChannels {
  readonly presidio: PresidioChannel;
  /** Answers Presidio's own exchange; `not_configured` where the deployment names no model. */
  readonly piiRedactionModel: PresidioChannel;
  /** The split model for pieces of a long batch (ADR-207); unconfigured unless a Lambda ARN. */
  readonly piiRedactionModelSplit: PresidioChannel;
  readonly dlp: GoogleDlpChannel;
}
