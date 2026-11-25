// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestMailChannel } from "./digest-mail.channel.ts";

/** What digest reaches outside the process, built by the container from the tier (§5). */
export interface DigestChannels {
  readonly mail: DigestMailChannel;
}
