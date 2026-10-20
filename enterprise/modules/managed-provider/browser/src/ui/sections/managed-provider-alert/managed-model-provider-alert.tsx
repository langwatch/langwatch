import { Banner } from "@langwatch/design-system/banner";
import { Field } from "@langwatch/design-system/primitives";
import type { ManagedModelProvider } from "@langwatch/enterprise-managed-provider-contract";

export function ManagedModelProviderAlert({
  provider,
  error,
}: {
  provider: ManagedModelProvider;
  error?: string;
}) {
  return (
    <>
      <Banner status="warning">
        The {provider.provider} provider credentials is managed by LangWatch for your organization.
      </Banner>
      <Field.Root invalid={Boolean(error)}>
        <Field.ErrorText>{error}</Field.ErrorText>
      </Field.Root>
    </>
  );
}
