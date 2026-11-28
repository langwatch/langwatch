import type { ApiKeyApi } from "@langwatch/api-key-contract";

import type { GoogleDlpChannel } from "./google-dlp.channel.ts";
import type { PresidioChannel } from "./presidio.channel.ts";

/** The one api-key read data-privacy needs: the organization's keys, to name in an audience. */
export type OrganizationApiKeys = Pick<ApiKeyApi, "listAll">;

/** Every channel data-privacy holds, as the container hands them to the module class. */
export interface DataPrivacyChannels {
  readonly presidio: PresidioChannel;
  /** Answers Presidio's own exchange; `not_configured` where the deployment names no model. */
  readonly piiRedactionModel: PresidioChannel;
  readonly dlp: GoogleDlpChannel;
  /**
   * The organization's API keys, which a rule's audience may name (ADR-208). Bound to api-key,
   * not a peer: api-key reaches project, which depends on data-privacy (record §5).
   */
  readonly apiKeys: OrganizationApiKeys;
}
