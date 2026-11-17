import { Button, Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AwsConnectionView } from "@langwatch/enterprise-governance-contract";

import {
  type ConnectionFieldBinding,
  type ConnectionFields,
  type Credential,
  useAwsConnectionForm,
} from "../../behavior/use-aws-connection-form.ts";

function CredentialFields({
  credential,
  field,
}: {
  credential: Credential;
  field: (name: keyof ConnectionFields) => ConnectionFieldBinding;
}) {
  if (credential === "keys") {
    return (
      <>
        <Field.Root required>
          <Field.Label>Access key id</Field.Label>
          <Input aria-label="Access key id" {...field("accessKeyId")} />
        </Field.Root>
        <Field.Root required>
          <Field.Label>Secret access key</Field.Label>
          <Input
            aria-label="Secret access key"
            type="password"
            autoComplete="off"
            {...field("secretAccessKey")}
          />
          <Field.HelperText>Stored encrypted and never shown again.</Field.HelperText>
        </Field.Root>
      </>
    );
  }
  return (
    <>
      <Field.Root required>
        <Field.Label>Role ARN</Field.Label>
        <Input
          aria-label="Role ARN"
          placeholder="arn:aws:iam::123456789012:role/langwatch-governance"
          {...field("roleArn")}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>External id</Field.Label>
        <Input aria-label="External id" {...field("externalId")} />
      </Field.Root>
    </>
  );
}

/** Adds one AWS connection: a key pair or a role to assume, checked against the contract. */
export function AwsConnectionForm({
  organizationId,
  onDone,
}: {
  organizationId: string;
  /** Called with the new connection once it is saved, and with nothing on cancel. */
  onDone: (created?: AwsConnectionView) => void;
}) {
  const form = useAwsConnectionForm({ organizationId, onDone });

  return (
    <VStack
      align="stretch"
      gap={3}
      data-testid="aws-connection-form"
      // It sits inside the source form, where a nested <form> is invalid: Enter submits here.
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        void form.submit();
      }}
    >
      <Field.Root required>
        <Field.Label>Name</Field.Label>
        <Input aria-label="Connection name" {...form.field("name")} />
      </Field.Root>
      <SegmentedControl
        size="sm"
        aria-label="How it signs in"
        value={form.credential}
        onValueChange={({ value }) => form.pickCredential(value)}
        items={[
          { value: "keys", label: "Access key" },
          { value: "role", label: "Role to assume" },
        ]}
      />
      <CredentialFields credential={form.credential} field={form.field} />
      {form.error ? (
        <Text textStyle="sm" color="fg.error" role="alert">
          {form.error}
        </Text>
      ) : null}
      <HStack justify="end" gap={2}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={form.isSaving}
          onClick={() => onDone()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={form.isSaving}
          onClick={() => void form.submit()}
        >
          Add connection
        </Button>
      </HStack>
    </VStack>
  );
}
