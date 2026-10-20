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
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Button,
  Field,
  Heading,
  Input,
  SimpleGrid,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { useState } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import {
  consolePathFor,
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
import { OidcFields, SamlFields, type UpdateField } from "../elements/identity-provider-fields.tsx";
import { IdentityProviderTile } from "../elements/identity-provider-tile.tsx";
import { ProtocolChoice } from "../elements/protocol-choice.tsx";
import { InlineRefusal } from "../elements/refusals.tsx";
import { ServiceProviderSection } from "./service-provider.section.tsx";

/** What each registration is acknowledged with: the second answers the
 *  question that actually follows a replacement. */
const ACKNOWLEDGEMENTS = {
  first: {
    title: "Identity provider registered",
    description: "Next, prove you own the domain your people sign in with.",
  },
  replacement: {
    title: "Replacement registered",
    description: "Your current sign-in keeps working until you switch everyone over.",
  },
  operator: {
    title: "Replacement imported",
    description: "The organization's current sign-in keeps working until it is switched over.",
  },
} as const;

export function RegisterConnectionSection({
  organizationId,
  serviceProvider,
  canManage,
  replacesConnectionId,
  mode = "customer",
  onRegistered,
}: {
  organizationId: string;
  /** Our addresses for their console; an operator importing a supplied configuration needs none. */
  serviceProvider?: ServiceProviderAddresses;
  canManage: boolean;
  /** The grandfathered connection this registration replaces, when it is one:
   *  the domains it proved carry over, and sign-in stays where it is. */
  replacesConnectionId?: string;
  /** `operator`: the back office imports the customer's configuration as the replacement. */
  mode?: "customer" | "operator";
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
  const operatorMigrate = ssoApi.ssoConnections.startLegacyMigration.useMutation();
  const utils = ssoApi.useUtils();
  const operatorImport = mode === "operator";

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
        if (operatorImport) await utils.ssoConnections.invalidate();
        await onRegistered?.();
        host.succeeded(
          ACKNOWLEDGEMENTS[acknowledgementFor({ operatorImport, replacesConnectionId })],
        );
      },
    };

    if (replacesConnectionId !== undefined) {
      (operatorImport ? operatorMigrate : migrate).mutate(
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
      <NoDataInfoBlock
        size="line"
        title="No identity provider is registered for this organization yet. An organization administrator can set one up here."
        testId="sso-register-unavailable"
      />
    );
  }

  return (
    <VStack align="stretch" gap={6} data-testid="sso-register-connection">
      <ProviderPicker selected={preset} onPick={pick} />
      {preset && (
        <>
          {serviceProvider && !operatorImport && (
            <ProviderConsoleAct
              preset={preset}
              serviceProvider={serviceProvider}
              protocol={protocol}
            />
          )}
          <CredentialsAct
            preset={preset}
            protocol={protocol}
            onProtocolChange={setProtocol}
            form={form}
            update={update}
            pending={register.isPending || migrate.isPending || operatorMigrate.isPending}
            onSubmit={submit}
            submitLabel={submitLabelFor({ operatorImport, replacesConnectionId })}
            refusal={register.error ?? migrate.error ?? operatorMigrate.error}
          />
        </>
      )}
    </VStack>
  );
}

/** Which acknowledgement a settled registration earns. */
function acknowledgementFor({
  operatorImport,
  replacesConnectionId,
}: {
  operatorImport: boolean;
  replacesConnectionId: string | undefined;
}): keyof typeof ACKNOWLEDGEMENTS {
  if (operatorImport) return "operator";
  return replacesConnectionId === undefined ? "first" : "replacement";
}

/** The button's words: main's "Import replacement" is the operator's. */
function submitLabelFor({
  operatorImport,
  replacesConnectionId,
}: {
  operatorImport: boolean;
  replacesConnectionId: string | undefined;
}): string {
  if (operatorImport) return "Import replacement";
  return replacesConnectionId === undefined ? "Register" : "Register replacement";
}

/**
 * Act one: the recognition question, and nothing else on screen yet.
 *
 * TWO GROUPS, BECAUSE TWO PEOPLE ARRIVE HERE: the administrator who knows
 * their company runs Okta, and the engineer holding a metadata file who knows
 * only that it is SAML. The second is not made to pick "Something else".
 */
/**
 * The narrowest a provider tile gets: wide enough for the longest name ("Microsoft Entra ID") on
 * one line beside its mark, so the grid drops a column before a name is cut.
 */
const PROVIDER_TILE_MIN_WIDTH = "12rem";

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
        <Heading textStyle="cardTitle">Who signs your team in?</Heading>
        <Text color="fg.muted" fontSize="sm">
          Pick your identity provider and we&apos;ll walk you through its side of the setup.
        </Text>
      </VStack>
      <SimpleGrid
        minChildWidth={PROVIDER_TILE_MIN_WIDTH}
        gap={2}
        data-testid="sso-provider-products"
      >
        {tilesFor("product")}
      </SimpleGrid>

      <VStack align="stretch" gap={2}>
        <Text color="fg.muted" fontSize="sm">
          Or connect by protocol, if you already know which one you have.
        </Text>
        <SimpleGrid
          minChildWidth={PROVIDER_TILE_MIN_WIDTH}
          gap={2}
          data-testid="sso-provider-protocols"
        >
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
  const consolePath = consolePathFor({ preset, protocol });

  return (
    <VStack align="stretch" gap={3} data-testid="sso-register-console">
      <VStack align="stretch" gap={1}>
        <Heading textStyle="cardTitle">
          {preset.group === "protocol" ? "Give it our addresses" : `Set it up in ${preset.name}`}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {consolePath
            ? `In ${preset.name}, create the app under ${consolePath}, and give it these addresses when it asks.`
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
        <Heading textStyle="cardTitle">
          {preset.group === "protocol"
            ? "Then bring back what it gives you"
            : `Then bring back what ${preset.name} gives you`}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {preset.protocolIsChosen
            ? "These are the values your identity provider's app hands back."
            : "There are two ways to connect. Pick the one your identity provider's app gave you. Either one works."}
        </Text>
      </VStack>
      {/* A tile that IS a protocol has answered this already; asking again
          under the tile just pressed reads as not having heard it. */}
      {!preset.protocolIsChosen && <ProtocolChoice value={protocol} onChange={onProtocolChange} />}
      <Field.Root>
        <Field.Label>Connection name</Field.Label>
        <Input
          placeholder="For example Okta"
          data-testid="sso-register-name"
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
