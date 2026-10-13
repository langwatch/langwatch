// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What sso lends to screens it does not own, by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

import { SSO_FEATURE_ID } from "./sso.contract.ts";

/** What the back office hands the replacement import beside a carried-over connection. */
export type SsoReplacementImportProps = {
  organizationId: string;
  /** The grandfathered connection the imported configuration replaces. */
  replacesConnectionId: string;
};

/** An operator imports the customer's OIDC or SAML configuration as the replacement. */
export const SsoReplacementImportToken =
  uiTokens(SSO_FEATURE_ID).component<SsoReplacementImportProps>("replacementImport");
