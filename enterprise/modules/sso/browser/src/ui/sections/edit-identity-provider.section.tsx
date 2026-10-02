// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Changing an existing connection's identity provider settings in place. The
 * connection keeps its id, so the redirect address the administrator already
 * gave their identity provider keeps working, and its domains, proofs and
 * arrival policy stay. Rendered on the card, like the rename beside it.
 */
import { Button, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { SsoSetupIdentityProviderView } from "@langwatch/enterprise-sso-contract";
import { useState } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { useIdentityProviderEdit } from "../../behavior/use-identity-provider-edit.ts";
import { identityProviderFormFrom } from "../../model/identity-provider-edit.ts";
import { identityProviderPreset } from "../../model/identity-providers.ts";
import type { RegisterForm } from "../../model/registration-form.ts";
import { OidcFields, SamlFields, type UpdateField } from "../elements/identity-provider-fields.tsx";
import { InlineRefusal, LoadFailure } from "../elements/refusals.tsx";

export function EditIdentityProviderSection({
  organizationId,
  connectionId,
  onDone,
}: {
  organizationId: string;
  connectionId: string;
  onDone: () => void;
}) {
  const current = ssoApi.ssoSetup.identityProvider.useQuery({ organizationId, connectionId });

  if (current.isLoading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading your identity provider settings…
      </Text>
    );
  }
  if (current.error) {
    return <LoadFailure error={current.error} what="your identity provider settings" />;
  }
  if (!current.data) {
    return (
      <Text fontSize="sm" color="fg.muted">
        This connection has no identity provider settings of its own to change.
      </Text>
    );
  }

  return (
    <EditIdentityProviderForm
      organizationId={organizationId}
      connectionId={connectionId}
      current={current.data}
      onDone={onDone}
    />
  );
}

function EditIdentityProviderForm({
  organizationId,
  connectionId,
  current,
  onDone,
}: {
  organizationId: string;
  connectionId: string;
  current: SsoSetupIdentityProviderView;
  onDone: () => void;
}) {
  const [form, setForm] = useState<RegisterForm>(() => identityProviderFormFrom(current));
  const edit = useIdentityProviderEdit({
    organizationId,
    connectionId,
    protocol: current.protocol,
    onSaved: onDone,
  });
  const preset = identityProviderPreset(current.protocol);
  const keepsSecret = current.protocol === "oidc" && current.hasClientSecret;

  const update: UpdateField = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  return (
    <VStack align="stretch" gap={3} paddingTop={2} data-testid="edit-identity-provider">
      <VStack align="stretch" gap={1}>
        <Heading size="sm">Identity provider settings</Heading>
        <Text color="fg.muted" fontSize="sm">
          The redirect address stays the same, and so do your domains and who this connection
          admits.
        </Text>
      </VStack>
      {current.protocol === "oidc" ? (
        <OidcFields
          preset={preset}
          form={form}
          update={update}
          secretHint={keepsSecret ? "Leave blank to keep the current secret." : void 0}
        />
      ) : (
        <SamlFields preset={preset} form={form} update={update} />
      )}
      <InlineRefusal error={edit.refusal} what="Saving the identity provider settings" />
      <HStack gap={2}>
        <Button
          size="sm"
          loading={edit.saving}
          onClick={() => edit.save(form)}
          data-testid="edit-identity-provider-save"
        >
          Save changes
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={edit.saving}
          data-testid="edit-identity-provider-cancel"
        >
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}
