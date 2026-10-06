/** What managed-provider lends to model-provider's credentials form (§11). */

import { uiTokens } from "@langwatch/module";

import type { ManagedModelProvider } from "./managed-provider.api.ts";

/** Said above a provider's credentials when the credentials are not the customer's. */
export type ManagedModelProviderAlertProps = { provider: ManagedModelProvider; error?: string };

export const ManagedModelProviderAlertToken = uiTokens(
  "managed-provider",
).component<ManagedModelProviderAlertProps>("managedModelProviderAlert");
