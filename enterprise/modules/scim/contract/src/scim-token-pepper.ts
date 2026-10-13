// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's directory-token pepper: CREDENTIALS_SECRET, else NEXTAUTH_SECRET. Off the index: node-only. */
import {
  credentialsSecret,
  credentialsSecretPrevious,
  sessionSecret,
} from "@langwatch/secrets/shared-secrets";

export const scimTokenPepperSecrets = {
  tokenPepper: credentialsSecret,
  tokenPepperFallback: sessionSecret,
  /** Finds a token stored before a CREDENTIALS_SECRET rotation; its digest moves on that use. */
  tokenPepperPrevious: credentialsSecretPrevious,
} as const;
