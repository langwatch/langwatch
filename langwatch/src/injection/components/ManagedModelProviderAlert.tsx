/**
 * Reference implementation for Managed Model Provider Alert Component
 * 
 * BUG FIX #0913: Grammar correction
 * Changed "is managed" to "are managed" because "credentials" is plural
 * 
 * This component should be used in the saas-src managed model provider component
 * to display the correct alert message when model provider credentials are managed
 * by LangWatch.
 */

import { Alert } from "@chakra-ui/react";
import type React from "react";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";

interface ManagedModelProviderAlertProps {
  provider: MaybeStoredModelProvider;
}

export const ManagedModelProviderAlert: React.FC<
  ManagedModelProviderAlertProps
> = ({ provider }) => {
  const providerName = provider.provider;

  return (
    <Alert.Root status="info" variant="subtle">
      <Alert.Indicator />
      <Alert.Content>
        The {providerName} provider credentials are managed by LangWatch for
        your organization.
      </Alert.Content>
    </Alert.Root>
  );
};
