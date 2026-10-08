/** What managed-provider lends to model-provider's credentials form (§10.1, §11). */

import type { ManagedModelProvider } from "@langwatch/enterprise-managed-provider-contract";
import { uiTokens } from "@langwatch/module";

/** Said above a provider's credentials when the credentials are not the customer's. */
export type ManagedModelProviderAlertProps = { provider: ManagedModelProvider; error?: string };

export const ManagedModelProviderAlertToken = uiTokens(
  "managed-provider",
).component<ManagedModelProviderAlertProps>("managedModelProviderAlert");
