import { Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import type { SelfServeIdentityProviderView } from "@ee/sso/sso-self-serve.types";
import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { identityProviderPreset } from "./identityProviders";
import {
  EMPTY_FORM,
  OidcFields,
  type RegisterForm,
  SamlFields,
  type UpdateField,
} from "./RegisterConnection";
import { InlineRefusal, LoadFailure } from "./refusals";

/**
 * Changing an existing connection's identity provider settings: the issuer,
 * client id and client secret for OpenID Connect, or the sign-in address,
 * metadata, entity id and certificate for SAML.
 *
 * The connection keeps its id, so the redirect address the administrator
 * already gave their identity provider keeps working, and its domains,
 * proofs, arrival policy and linked accounts stay. Discarding the connection
 * and registering again is what used to be the only fix, and it changes that
 * address.
 *
 * Rendered in place on the connection's card, like the rename beside it: it
 * edits fields of the card the administrator is already reading, and the
 * single sign-on settings have no drawer surface.
 */
export function EditIdentityProvider({
  organizationId,
  connectionId,
  onDone,
}: {
  organizationId: string;
  connectionId: string;
  onDone: () => void;
}) {
  const current = api.ssoSetup.identityProvider.useQuery({
    organizationId,
    connectionId,
  });

  if (current.isLoading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading your identity provider settings…
      </Text>
    );
  }
  if (current.error) {
    return (
      <LoadFailure
        error={current.error}
        what="your identity provider settings"
      />
    );
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

function formFrom(current: SelfServeIdentityProviderView): RegisterForm {
  if (current.protocol === "oidc") {
    return {
      ...EMPTY_FORM,
      issuer: current.issuer ?? "",
      clientId: current.clientId ?? "",
    };
  }
  return {
    ...EMPTY_FORM,
    entryPoint: current.entryPoint ?? "",
    entityId: current.entityId ?? "",
    metadataXml: current.metadataXml ?? "",
    certificate: current.certificate ?? "",
  };
}

/** The form in the shape the update takes. A blank client secret is sent as
 *  null, which keeps the stored one. */
function updateFromForm({
  protocol,
  form,
}: {
  protocol: SelfServeIdentityProviderView["protocol"];
  form: RegisterForm;
}) {
  return protocol === "oidc"
    ? ({
        protocol,
        issuer: form.issuer,
        clientId: form.clientId,
        clientSecret: form.clientSecret === "" ? null : form.clientSecret,
      } as const)
    : ({
        protocol,
        entryPoint: form.entryPoint,
        entityId: form.entityId || null,
        metadataXml: form.metadataXml || null,
        certificate: form.certificate || null,
      } as const);
}

function EditIdentityProviderForm({
  organizationId,
  connectionId,
  current,
  onDone,
}: {
  organizationId: string;
  connectionId: string;
  current: SelfServeIdentityProviderView;
  onDone: () => void;
}) {
  const [form, setForm] = useState<RegisterForm>(() => formFrom(current));
  const save = api.ssoSetup.updateIdentityProvider.useMutation();
  const utils = api.useUtils();
  const preset = identityProviderPreset(current.protocol);
  const keepsSecret = current.protocol === "oidc" && current.hasClientSecret;

  const update: UpdateField = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    save.mutate(
      {
        organizationId,
        connectionId,
        idp: updateFromForm({ protocol: current.protocol, form }),
      },
      {
        onSuccess: async () => {
          const target = { organizationId, connectionId };
          await Promise.all([
            utils.ssoSetup.getSetup.invalidate(),
            utils.ssoSetup.identityProvider.invalidate(target),
            utils.ssoSetup.getHistory.invalidate(target),
          ]);
          toaster.create({
            title: "Identity provider settings saved",
            description:
              "Your redirect address is unchanged, so nothing needs to change in your identity provider.",
            type: "success",
          });
          onDone();
        },
      },
    );
  };

  return (
    <VStack
      align="stretch"
      gap={3}
      paddingTop={2}
      data-testid="edit-identity-provider"
    >
      <VStack align="stretch" gap={1}>
        <Heading size="sm">Identity provider settings</Heading>
        <Text color="fg.muted" fontSize="sm">
          The redirect address stays the same, and so do your domains and who
          this connection admits.
        </Text>
      </VStack>
      {current.protocol === "oidc" ? (
        <OidcFields
          preset={preset}
          form={form}
          update={update}
          secretHint={
            keepsSecret ? "Leave blank to keep the current secret." : undefined
          }
        />
      ) : (
        <SamlFields preset={preset} form={form} update={update} />
      )}
      <InlineRefusal
        error={save.error}
        what="Saving the identity provider settings"
      />
      <HStack gap={2}>
        <Button
          size="sm"
          loading={save.isPending}
          onClick={submit}
          data-testid="edit-identity-provider-save"
        >
          Save changes
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={save.isPending}
          data-testid="edit-identity-provider-cancel"
        >
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}
