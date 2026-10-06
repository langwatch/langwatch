/** Scim's drawers, by token: the one way a caller opens them (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

/** What a caller hands the provisioning-setup drawer. */
export type UiProvisioningSetupDrawerProps = {
  open?: boolean;
};

const drawers = uiTokens("scim");

/** SCIM provisioning for the reader's organization: the address, the tokens, the sync. */
export const ProvisioningSetupDrawerToken =
  drawers.drawer<UiProvisioningSetupDrawerProps>("provisioningSetup");
