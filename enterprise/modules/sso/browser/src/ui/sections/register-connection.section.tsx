// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Registering, once the other side exists.
 *
 * THE FIRST QUESTION IS THE ONE THE ADMINISTRATOR CAN ANSWER: not "OIDC or
 * SAML?" but "who signs your team in?". Picking the provider prefills the
 * connection's name, points at where in that console the application is
 * created, and pre-answers the protocol in that provider's own default. The
 * form arrives one act at a time — pick who, give their console our
 * addresses, bring back what it hands you.
 */
import {
  Button,
  Field,
  Heading,
  Input,
  SimpleGrid,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import {
  identityProvidersIn,
  type IdentityProviderPreset,
  type SsoProtocol,
} from "../../model/identity-providers.ts";
import {
  EMPTY_REGISTER_FORM,
  idpFromForm,
  providerNameAfterPick,
  type RegisterForm,
} from "../../model/registration-form.ts";
import type { ServiceProviderAddresses } from "../../model/service-provider-rows.ts";
import { useSsoHost } from "../../model/sso-host.ts";
import { IdentityProviderTile } from "../elements/identity-provider-tile.tsx";
import { ProtocolChoice } from "../elements/protocol-choice.tsx";
import { InlineRefusal } from "../elements/refusals.tsx";
import { ServiceProviderSection } from "./service-provider.section.tsx";

type UpdateField = (key: keyof RegisterForm) => (value: string) => void;

/** What each registration is acknowledged with: the second answers the
 *  question that actually follows a replacement. */
const ACKNOWLEDGEMENTS = {
  first: {
    title: "Identity provider registered",
    description: "Next, prove you own the domain your people sign in with.",
  },
  replacement: {
    title: "Replacement registered",
    description: "Your current sign-in keeps working until you switch traffic over.",
  },
} as const;

export function RegisterConnectionSection({
  organizationId,
  serviceProvider,
  canManage,
  replacesConnectionId,
  onRegistered,
}: {
  organizationId: string;
  serviceProvider: ServiceProviderAddresses;
  canManage: boolean;
  /** The grandfathered connection this registration replaces, when it is one:
   *  the domains it proved carry over, and sign-in stays where it is. */
  replacesConnectionId?: string;
  /**
   * Awaited: firing the read and forgetting it left a window where the
   * command had settled, the form showed exactly what it showed before, and
   * the only thing an administrator could do was press again — which is how
   * you get two registrations.
   */
  onRegistered?: () => Promise<unknown> | void;
}) {
  const host = useSsoHost();
  const [preset, setPreset] = useState<IdentityProviderPreset | null>(null);
  const [protocol, setProtocol] = useState<SsoProtocol>("oidc");
  const [form, setForm] = useState<RegisterForm>(EMPTY_REGISTER_FORM);
  const register = ssoApi.ssoSetup.register.useMutation();
  const migrate = ssoApi.ssoSetup.startLegacyMigration.useMutation();

  const update: UpdateField = (key) => (value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const pick = (next: IdentityProviderPreset) => {
    setProtocol(next.defaultProtocol);
    setForm((current) => ({
      ...current,
      providerId: providerNameAfterPick({
        preset: next,
        previous: preset,
        current: current.providerId,
      }),
    }));
    setPreset(next);
  };

  const submit = () => {
    const idp = idpFromForm({ protocol, form });
    const settle = {
      // AWAITED, and then said out loud: the read is what moves the page on,
      // and the acknowledgement is of the ACT, which a screen changing
      // underneath the reader is not.
      onSuccess: async () => {
        await onRegistered?.();
        host.succeeded(
          ACKNOWLEDGEMENTS[replacesConnectionId === undefined ? "first" : "replacement"],
        );
      },
    };

    if (replacesConnectionId !== undefined) {
      migrate.mutate(
        {
          organizationId,
          legacyConnectionId: replacesConnectionId,
          providerId: form.providerId,
          idp,
        },
        settle,
      );

      return;
    }

    register.mutate({ organizationId, providerId: form.providerId, idp }, settle);
  };

  if (!canManage) {
    return (
      <Text color="fg.muted" fontSize="sm" data-testid="sso-register-unavailable">
        No identity provider is registered for this organization yet. An organization administrator
        can set one up here.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={6} data-testid="sso-register-connection">
      <ProviderPicker selected={preset} onPick={pick} />
      {preset && (
        <>
          <ProviderConsoleAct
            preset={preset}
            serviceProvider={serviceProvider}
            protocol={protocol}
          />
          <CredentialsAct
            preset={preset}
            protocol={protocol}
            onProtocolChange={setProtocol}
            form={form}
            update={update}
            pending={register.isPending || migrate.isPending}
            onSubmit={submit}
            submitLabel={replacesConnectionId === undefined ? "Register" : "Register replacement"}
            refusal={register.error ?? migrate.error}
          />
        </>
      )}
    </VStack>
  );
}

/**
 * Act one: the recognition question, and nothing else on screen yet.
 *
 * TWO GROUPS, BECAUSE TWO PEOPLE ARRIVE HERE: the administrator who knows
 * their company runs Okta, and the engineer holding a metadata file who knows
 * only that it is SAML. The second is not made to pick "Something else".
 */
function ProviderPicker({
  selected,
  onPick,
}: {
  selected: IdentityProviderPreset | null;
  onPick: (preset: IdentityProviderPreset) => void;
}) {
  const tilesFor = (group: "product" | "protocol") =>
    identityProvidersIn(group).map((entry) => (
      <IdentityProviderTile
        key={entry.id}
        preset={entry}
        selected={selected?.id === entry.id}
        onPick={() => onPick(entry)}
      />
    ));

  return (
    <VStack align="stretch" gap={4}>
      <VStack align="stretch" gap={1}>
        <Heading size="sm">Who signs your team in?</Heading>
        <Text color="fg.muted" fontSize="sm">
          Pick your identity provider and we&apos;ll walk you through its side of the setup.
        </Text>
      </VStack>
      <SimpleGrid columns={{ base: 2, md: 4 }} gap={2} data-testid="sso-provider-products">
        {tilesFor("product")}
      </SimpleGrid>

      <VStack align="stretch" gap={2}>
        <Text color="fg.muted" fontSize="sm">
          Or connect by protocol, if you already know which one you have.
        </Text>
        <SimpleGrid columns={{ base: 2, md: 4 }} gap={2} data-testid="sso-provider-protocols">
          {tilesFor("protocol")}
        </SimpleGrid>
      </VStack>
    </VStack>
  );
}

/** Act two: their console's side — where to create the application, and the
 *  addresses to hand it, scoped to the protocol in play. */
function ProviderConsoleAct({
  preset,
  serviceProvider,
  protocol,
}: {
  preset: IdentityProviderPreset;
  serviceProvider: ServiceProviderAddresses;
  protocol: SsoProtocol;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="sso-register-console">
      <VStack align="stretch" gap={1}>
        <Heading size="sm">
          {preset.group === "protocol" ? "Give it our addresses" : `Set it up in ${preset.name}`}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {preset.consolePath
            ? `In ${preset.name}, create the app under ${preset.consolePath}, and give it these addresses when it asks.`
            : "Create an app for LangWatch in your identity provider, and give it these addresses when it asks."}
        </Text>
      </VStack>
      <ServiceProviderSection protocol={protocol} addresses={serviceProvider} connected={false} />
    </VStack>
  );
}

/** Act three: what their console handed back. The protocol cards stay
 *  visible — the preset chose a default, not the answer. */
function CredentialsAct({
  preset,
  protocol,
  onProtocolChange,
  form,
  update,
  pending,
  onSubmit,
  submitLabel,
  refusal,
}: {
  preset: IdentityProviderPreset;
  protocol: SsoProtocol;
  onProtocolChange: (protocol: SsoProtocol) => void;
  form: RegisterForm;
  update: UpdateField;
  pending: boolean;
  onSubmit: () => void;
  submitLabel: string;
  /** What the last attempt was refused with, beside the button that made it. */
  refusal: unknown;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="sso-register-credentials">
      <VStack align="stretch" gap={1}>
        <Heading size="sm">
          {preset.group === "protocol"
            ? "Then bring back what it gives you"
            : `Then bring back what ${preset.name} gives you`}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {preset.protocolIsChosen
            ? "These are the values your identity provider's app hands back."
            : "Two ways to connect: pick whichever your identity provider's app gave you. Either one works."}
        </Text>
      </VStack>
      {/* A tile that IS a protocol has answered this already; asking again
          under the tile just pressed reads as not having heard it. */}
      {!preset.protocolIsChosen && <ProtocolChoice value={protocol} onChange={onProtocolChange} />}
      <Field.Root>
        <Field.Label>Connection name</Field.Label>
        <Input
          placeholder="For example Okta"
          value={form.providerId}
          onChange={(event) => update("providerId")(event.target.value)}
        />
        <Field.HelperText>
          What this connection is called on the sign-in screen and in the audit log.
        </Field.HelperText>
      </Field.Root>
      {protocol === "oidc" ? (
        <OidcFields preset={preset} form={form} update={update} />
      ) : (
        <SamlFields preset={preset} form={form} update={update} />
      )}
      <InlineRefusal error={refusal} what="Registering that connection" />
      <Button alignSelf="start" loading={pending} onClick={onSubmit} data-testid="sso-register">
        {submitLabel}
      </Button>
    </VStack>
  );
}

function OidcFields({
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
        <Field.Label>Issuer address</Field.Label>
        <Input
          placeholder={preset.issuerExample}
          value={form.issuer}
          onChange={(event) => update("issuer")(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Client id</Field.Label>
        <Input value={form.clientId} onChange={(event) => update("clientId")(event.target.value)} />
      </Field.Root>
      <Field.Root>
        <Field.Label>Client secret</Field.Label>
        <Input
          type="password"
          value={form.clientSecret}
          onChange={(event) => update("clientSecret")(event.target.value)}
        />
      </Field.Root>
    </>
  );
}

function SamlFields({
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
