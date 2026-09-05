/**
 * What fills the notice the credential form leaves room for when the
 * credentials are not the customer's to enter.
 */

import { ManagedModelProviderAlert } from "@langwatch/enterprise-managed-provider-web/surfaces/managed-provider-alert";
import type { UiSlotComponents, UiSlotProps } from "@langwatch/ui-host/slots";

/** The notice names a provider; the form has only its key. They meet here. */
function ManagedProviderNotice({ provider, error }: UiSlotProps["managedModelProviderAlert"]) {
  return <ManagedModelProviderAlert provider={{ provider }} error={error} />;
}

export const modelProviderUiSlots: UiSlotComponents = {
  managedModelProviderAlert: ManagedProviderNotice,
};
