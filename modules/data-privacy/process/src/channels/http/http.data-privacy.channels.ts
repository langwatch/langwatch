import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { DataPrivacyChannels } from "../data-privacy.channels.ts";
import { googleApplicationCredentials } from "../google-dlp.channel.ts";
import { HttpGoogleDlpChannel } from "./http.google-dlp.channel.ts";
import { HttpPresidioChannel } from "./http.presidio.channel.ts";

/** PII detection goes to the langevals Presidio endpoint and Google Cloud DLP. */
export class HttpDataPrivacyChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: DataPrivacyServerConfig;
    secrets: ScopedSecrets;
  }): Promise<DataPrivacyChannels> {
    const dlp = await secrets.into(googleApplicationCredentials, (credential) =>
      HttpGoogleDlpChannel.create({ credential }),
    );
    return { presidio: HttpPresidioChannel.create({ endpoint: config.langevalsEndpoint }), dlp };
  }
}
