// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's directory-token pepper: CREDENTIALS_SECRET, else NEXTAUTH_SECRET. Off the index: node-only. */
import { credentialsSecret, sessionSecret } from "@langwatch/secrets";

export const scimTokenPepperSecrets = {
  tokenPepper: credentialsSecret,
  tokenPepperFallback: sessionSecret,
} as const;
