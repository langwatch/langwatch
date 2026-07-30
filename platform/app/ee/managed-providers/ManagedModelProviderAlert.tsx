import { Alert, Field } from "@chakra-ui/react";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";

/**
 * Displays a message indicating that the model provider credentials
 * are managed by LangWatch for the organization.
 */
export const ManagedModelProviderAlert = ({
  provider,
  error,
}: {
  provider: MaybeStoredModelProvider;
  error?: string;
}) => {
  return (
    <>
      <Alert.Root status="warning">
        <Alert.Indicator />
        <Alert.Title>
          The {provider.provider} provider credentials is managed by LangWatch
          for your organization.
        </Alert.Title>
      </Alert.Root>
      <Field.Root invalid={!!error}>
        <Field.ErrorText>{error}</Field.ErrorText>
      </Field.Root>
    </>
  );
};
