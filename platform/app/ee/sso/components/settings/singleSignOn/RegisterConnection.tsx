import {
  Box,
  Button,
  chakra,
  Field,
  Heading,
  Input,
  SimpleGrid,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { SelfServeSetupView } from "@ee/sso/sso-self-serve.types";
import { Check, FileCode2, KeyRound } from "lucide-react";
import { useState } from "react";
import { IconRadioCardGroup } from "~/components/forms/IconRadioCardGroup";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import {
  type IdentityProviderPreset,
  identityProvidersIn,
  type SsoProtocol,
} from "./identityProviders";
import { InlineRefusal } from "./refusals";
import { ServiceProviderDetails } from "./ServiceProviderDetails";

/**
 * Registering, once the other side exists.
 *
 * THE FIRST QUESTION IS THE ONE THE ADMINISTRATOR CAN ANSWER. Not "OIDC or
 * SAML?" — most people sent here don't know which word their security team's
 * export goes by — but "who signs your team in?", which everybody knows.
 * Picking the provider prefills the connection's name, points at where in
 * that console the app is created, and pre-answers the protocol question in
 * the provider's own default. The protocol stays visible and changeable
 * below, because pre-answered must never mean hidden.
 *
 * Until a provider is picked, nothing else is on the screen. The form the
 * old screen showed all at once — eight fields, two protocols, three
 * addresses — arrives one act at a time: pick who, give their console our
 * addresses, bring back what it hands you.
 */

interface RegisterForm {
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  entryPoint: string;
  entityId: string;
  metadataXml: string;
  certificate: string;
}

const EMPTY_FORM: RegisterForm = {
  providerId: "",
  issuer: "",
  clientId: "",
  clientSecret: "",
  entryPoint: "",
  entityId: "",
  metadataXml: "",
  certificate: "",
};

type UpdateField = (key: keyof RegisterForm) => (value: string) => void;

/**
 * The identity-provider half of the form, in the shape the command takes.
 *
 * The two protocols carry different evidence: OIDC is an issuer and a client
 * credential, SAML is an entry point plus whatever the administrator had —
 * metadata, a certificate, or neither. Empty strings become null so "not
 * supplied" and "supplied as blank" cannot be confused downstream.
 */
function idpFromForm({
  protocol,
  form,
}: {
  protocol: SsoProtocol;
  form: RegisterForm;
}) {
  return protocol === "oidc"
    ? ({
        protocol,
        issuer: form.issuer,
        clientId: form.clientId,
        clientSecret: form.clientSecret,
      } as const)
    : ({
        protocol,
        entryPoint: form.entryPoint,
        entityId: form.entityId || null,
        metadataXml: form.metadataXml || null,
        certificate: form.certificate || null,
      } as const);
}

export function RegisterConnection({
  organizationId,
  serviceProvider,
  replacesConnectionId,
  mode = "customer",
}: {
  organizationId: string;
  serviceProvider?: SelfServeSetupView["serviceProvider"];
  replacesConnectionId?: string;
  mode?: "customer" | "operator";
}) {
  const registration = useConnectionRegistration({
    organizationId,
    replacesConnectionId,
    mode,
  });
  const operatorImport = mode === "operator";
  return (
    <VStack align="stretch" gap={6}>
      <ProviderPicker
        selected={registration.preset}
        onPick={registration.pick}
      />
      {registration.preset && (
        <>
          {serviceProvider && !operatorImport && (
            <ProviderConsoleAct
              preset={registration.preset}
              serviceProvider={serviceProvider}
              protocol={registration.protocol}
            />
          )}
          <CredentialsAct
            preset={registration.preset}
            protocol={registration.protocol}
            onProtocolChange={registration.setProtocol}
            form={registration.form}
            update={registration.update}
            pending={registration.pending}
            onSubmit={registration.submit}
            error={registration.error}
            submitLabel={operatorImport ? "Import replacement" : "Register"}
          />
        </>
      )}
    </VStack>
  );
}

function useConnectionRegistration({
  organizationId,
  replacesConnectionId,
  mode,
}: {
  organizationId: string;
  replacesConnectionId?: string;
  mode: "customer" | "operator";
}) {
  const [preset, setPreset] = useState<IdentityProviderPreset | null>(null);
  const [protocol, setProtocol] = useState<SsoProtocol>("oidc");
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const register = api.ssoSetup.register.useMutation();
  const migrate = api.ssoSetup.startLegacyMigration.useMutation();
  const operatorMigrate = api.ssoConnections.startLegacyMigration.useMutation();
  const utils = api.useUtils();
  const operatorImport = mode === "operator";

  const update: UpdateField = (key) => (value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const pick = (next: IdentityProviderPreset) => {
    setPreset(next);
    setProtocol(next.defaultProtocol);
    // The name is prefilled, not fixed: it is this connection's label in
    // the audit log and the sign-in screen, and the provider's product name
    // is almost always what a team calls it.
    if (
      next.group === "product" &&
      (form.providerId === "" || form.providerId === preset?.name)
    ) {
      update("providerId")(next.name);
    }
  };

  const submit = () => {
    const idp = idpFromForm({ protocol, form });
    const settle = {
      // AWAITED, and then said out loud. Firing the refetch and forgetting it
      // left a window where the command had already settled, the form still
      // showed exactly what it showed before, and the only thing an
      // administrator could do was press the button again - which is how you
      // get two registrations. Awaiting it keeps the button busy until the
      // screen actually holds the connection, and the toast acknowledges the
      // ACT, which the screen moving underneath it does not.
      onSuccess: async () => {
        if (operatorImport) {
          await utils.ssoConnections.invalidate();
        } else {
          await utils.ssoSetup.getSetup.invalidate();
        }
        toaster.create({
          title: replacesConnectionId
            ? "Replacement registered"
            : "Identity provider registered",
          description: replacesConnectionId
            ? "Your current sign-in keeps working until you switch traffic over."
            : "Next, prove you own the domain your people sign in with.",
          type: "success",
        });
      },
    };
    if (replacesConnectionId) {
      const migration = operatorImport ? operatorMigrate : migrate;
      migration.mutate(
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
    register.mutate(
      { organizationId, providerId: form.providerId, idp },
      settle,
    );
  };

  return {
    preset,
    protocol,
    setProtocol,
    form,
    update,
    pick,
    submit,
    pending:
      register.isPending || migrate.isPending || operatorMigrate.isPending,
    error: register.error ?? migrate.error ?? operatorMigrate.error,
  };
}

/**
 * Act one: the recognition question, and nothing else on screen yet.
 *
 * TWO GROUPS, BECAUSE TWO PEOPLE ARRIVE HERE. The administrator who knows
 * their company runs Okta, and the engineer holding a metadata file who knows
 * only that it is SAML. The second used to have to pick "Something else" —
 * which reads as "your product is not supported" rather than "you already
 * know the answer" — so the protocols are named tiles of their own.
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
      <ProviderTile
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
          Pick your identity provider and we&apos;ll walk you through its side
          of the setup.
        </Text>
      </VStack>
      <SimpleGrid
        columns={{ base: 2, md: 4 }}
        gap={2}
        role="radiogroup"
        aria-label="Who signs your team in?"
      >
        {tilesFor("product")}
      </SimpleGrid>

      <VStack align="stretch" gap={2}>
        <Text color="fg.muted" fontSize="sm">
          Or connect by protocol, if you already know which one you have.
        </Text>
        <SimpleGrid
          columns={{ base: 2, md: 4 }}
          gap={2}
          role="radiogroup"
          aria-label="Connect by protocol"
        >
          {tilesFor("protocol")}
        </SimpleGrid>
      </VStack>
    </VStack>
  );
}

/** Act two: their console's side — where to create the app, and the
 *  addresses to hand it, scoped to the protocol in play. */
function ProviderConsoleAct({
  preset,
  serviceProvider,
  protocol,
}: {
  preset: IdentityProviderPreset;
  serviceProvider: SelfServeSetupView["serviceProvider"];
  protocol: SsoProtocol;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={1}>
        <Heading size="sm">
          {preset.group === "protocol"
            ? "Give it our addresses"
            : `Set it up in ${preset.name}`}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {preset.consolePath
            ? `In ${preset.name}, create the app under ${preset.consolePath}, and give it these addresses when it asks.`
            : "Create an app for LangWatch in your identity provider, and give it these addresses when it asks."}
        </Text>
      </VStack>
      <ServiceProviderDetails
        serviceProvider={serviceProvider}
        connected={false}
        protocol={protocol}
      />
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
  error,
  submitLabel,
}: {
  preset: IdentityProviderPreset;
  protocol: SsoProtocol;
  onProtocolChange: (protocol: SsoProtocol) => void;
  form: RegisterForm;
  update: UpdateField;
  pending: boolean;
  onSubmit: () => void;
  /** Why the last attempt was refused, rendered under the button rather
   *  than thrown into a corner for eight seconds. */
  error: unknown;
  submitLabel: string;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={1}>
        <Heading size="sm">
          {preset.group === "protocol"
            ? "Then bring back what it gives you"
            : `Then bring back what ${preset.name} gives you`}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {preset.protocolIsChosen
            ? "These are the values your identity provider's app hands back."
            : "Two ways to connect — pick whichever your identity provider's app gave you. Either one works."}
        </Text>
      </VStack>
      {/* A tile that IS a protocol has answered this already; asking again
          under the tile they just pressed reads as the screen not having
          heard them. Every other tile only PRE-answered it, so the cards
          stay — pre-answered must never mean hidden. */}
      {!preset.protocolIsChosen && (
        <IconRadioCardGroup
          ariaLabel="How will you connect?"
          value={protocol}
          onChange={(value) =>
            onProtocolChange(value === "saml" ? "saml" : "oidc")
          }
          items={[
            {
              title: "OpenID Connect",
              value: "oidc",
              icon: KeyRound,
              description: "You have a client id and a client secret.",
            },
            {
              title: "SAML",
              value: "saml",
              icon: FileCode2,
              description:
                "You have a metadata file, or a sign-in address and a certificate.",
            },
          ]}
        />
      )}
      <Field.Root>
        <Field.Label>Connection name</Field.Label>
        <Input
          placeholder="For example Okta"
          value={form.providerId}
          onChange={(event) => update("providerId")(event.target.value)}
        />
        <Field.HelperText>
          What this connection is called on the sign-in screen and in the audit
          log.
        </Field.HelperText>
      </Field.Root>
      {protocol === "oidc" ? (
        <OidcFields preset={preset} form={form} update={update} />
      ) : (
        <SamlFields preset={preset} form={form} update={update} />
      )}
      <InlineRefusal error={error} what="Registering that connection" />
      <Button alignSelf="start" loading={pending} onClick={onSubmit}>
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
        <Input
          value={form.clientId}
          onChange={(event) => update("clientId")(event.target.value)}
        />
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
        <Input
          value={form.entityId}
          onChange={(event) => update("entityId")(event.target.value)}
        />
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

/** One provider the administrator recognises: its own mark where the icon
 *  set has one, its initials where it does not, and the name. */
function ProviderTile({
  preset,
  selected,
  onPick,
}: {
  preset: IdentityProviderPreset;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      // The selected wash, border and monogram resolve against the brand
      // accent — set here because nothing above the tile carries a palette,
      // and a bare `colorPalette.*` reference would silently fall through to
      // the theme's default one.
      colorPalette="orange"
      display="flex"
      alignItems="center"
      gap={2.5}
      paddingX={3}
      paddingY={2.5}
      borderWidth="1px"
      borderColor={selected ? "colorPalette.solid" : "border.emphasized"}
      borderRadius="lg"
      background={selected ? "colorPalette.subtle" : "bg.panel"}
      cursor="pointer"
      textAlign="left"
      transition="all 0.15s ease"
      _hover={{ borderColor: selected ? "colorPalette.solid" : "border" }}
      data-testid={`identity-provider-${preset.id}`}
    >
      <Box
        width="7"
        height="7"
        borderRadius="md"
        background={selected ? "colorPalette.solid" : "bg.muted"}
        color={selected ? "colorPalette.contrast" : "fg.muted"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontSize="xs"
        fontWeight="semibold"
        flexShrink={0}
      >
        {selected ? (
          <Check size={14} aria-hidden />
        ) : preset.icon ? (
          <preset.icon size={15} aria-hidden />
        ) : (
          preset.monogram
        )}
      </Box>
      <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
        {preset.name}
      </Text>
    </chakra.button>
  );
}
