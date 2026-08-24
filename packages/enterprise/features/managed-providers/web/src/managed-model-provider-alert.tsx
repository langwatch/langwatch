import { Alert, Field } from "@chakra-ui/react";
import type { ManagedModelProvider } from "@langwatch/enterprise-managed-providers-contract";

export function ManagedModelProviderAlert({
  provider,
  error,
}: {
  provider: ManagedModelProvider;
  error?: string;
}) {
  return (
    <>
      <Alert.Root status="warning">
        <Alert.Indicator />
        <Alert.Title>
          The {provider.provider} provider credentials is managed by LangWatch
          for your organization.
        </Alert.Title>
      </Alert.Root>
      <Field.Root invalid={Boolean(error)}>
        <Field.ErrorText>{error}</Field.ErrorText>
      </Field.Root>
    </>
  );
}
