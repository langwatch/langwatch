// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Digest's settings: only the deployment origin its email links and unsubscribe address use. */
export const digestConfig = Config.define(() => ({ publicBaseUrl }));

export type DigestServerConfig = ConfigOf<typeof digestConfig>;
