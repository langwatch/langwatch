// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The values an identity provider's application hands back, one set per
 * protocol. Registering a connection and editing one ask for the same fields.
 */
import { Field, Input, Text, Textarea } from "@langwatch/design-system/primitives";

import type { IdentityProviderPreset } from "../../model/identity-providers.ts";
import type { RegisterForm } from "../../model/registration-form.ts";

export type UpdateField = (key: keyof RegisterForm) => (value: string) => void;

export function OidcFields({
  preset,
  form,
  update,
  secretHint,
}: {
  preset: IdentityProviderPreset;
  form: RegisterForm;
  update: UpdateField;
  /** Shown under the secret when a blank one keeps the stored secret. */
  secretHint?: string;
}) {
  return (
    <>
      <Field.Root>
        <Field.Label>Issuer address</Field.Label>
        <Input
          placeholder={preset.issuerExample}
          data-testid="sso-register-issuer"
          value={form.issuer}
          onChange={(event) => update("issuer")(event.target.value)}
        />
        {preset.issuerHint && <Field.HelperText>{preset.issuerHint}</Field.HelperText>}
      </Field.Root>
      <Field.Root>
        <Field.Label>Client id</Field.Label>
        <Input
          value={form.clientId}
          data-testid="sso-register-client-id"
          onChange={(event) => update("clientId")(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Client secret</Field.Label>
        <Input
          type="password"
          data-testid="sso-register-client-secret"
          value={form.clientSecret}
          onChange={(event) => update("clientSecret")(event.target.value)}
        />
        {secretHint && <Field.HelperText>{secretHint}</Field.HelperText>}
      </Field.Root>
    </>
  );
}

export function SamlFields({
  preset,
  form,
  update,
}: {
  preset: IdentityProviderPreset;
  form: RegisterForm;
  update: UpdateField;
}) {
  return (
    <>
      <Field.Root>
        <Field.Label>Sign-in address</Field.Label>
        <Input
          placeholder={preset.entryPointExample}
          value={form.entryPoint}
          onChange={(event) => update("entryPoint")(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Metadata</Field.Label>
        <Textarea
          rows={4}
          placeholder="Paste the XML your identity provider exports"
          value={form.metadataXml}
          onChange={(event) => update("metadataXml")(event.target.value)}
        />
      </Field.Root>
      <Text color="fg.muted" fontSize="sm">
        No metadata to paste? Give us these two instead.
      </Text>
      <Field.Root>
        <Field.Label>Entity id</Field.Label>
        <Input value={form.entityId} onChange={(event) => update("entityId")(event.target.value)} />
      </Field.Root>
      <Field.Root>
        <Field.Label>Signing certificate</Field.Label>
        <Textarea
          rows={4}
          placeholder="-----BEGIN CERTIFICATE-----"
          value={form.certificate}
          onChange={(event) => update("certificate")(event.target.value)}
        />
      </Field.Root>
    </>
  );
}
