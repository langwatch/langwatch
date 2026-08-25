import {
  Button,
  Field,
  Heading,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { FileCode2, KeyRound } from "lucide-react";
import { useState } from "react";
import { api } from "../../../utils/api";
import { IconRadioCardGroup } from "../../forms/IconRadioCardGroup";
import { reportRefusal } from "./refusals";
import { ServiceProviderDetails } from "./ServiceProviderDetails";

/**
 * Registering, once the other side exists.
 *
 * THE PROTOCOL IS THE FIRST CHOICE, AND IT IS VISIBLE. Two protocols behind a
 * dropdown read as one path with a hidden fork, and an administrator sent
 * here with a SAML metadata file could not see that the screen had a place
 * for it. Two cards name the protocols — OpenID Connect and SAML, the words
 * their identity provider's console uses — and each card says what having
 * chosen it means in the customer's words, because somebody handed a
 * metadata file by their security team does not necessarily know it is
 * called SAML.
 *
 * The choice also scopes everything under it: our addresses first (only the
 * ones the chosen protocol needs), then the fields to fill in. One choice,
 * one short list, one form.
 */
export function RegisterConnection({
  organizationId,
  serviceProvider,
}: {
  organizationId: string;
  serviceProvider: SelfServeSetupView["serviceProvider"];
}) {
  const [protocol, setProtocol] = useState<"oidc" | "saml">("oidc");
  const [providerId, setProviderId] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [entityId, setEntityId] = useState("");
  const [metadataXml, setMetadataXml] = useState("");
  const [certificate, setCertificate] = useState("");
  const register = api.ssoSetup.register.useMutation();
  const utils = api.useUtils();

  const idp =
    protocol === "oidc"
      ? ({ protocol, issuer, clientId, clientSecret } as const)
      : ({
          protocol,
          entryPoint,
          entityId: entityId || null,
          metadataXml: metadataXml || null,
          certificate: certificate || null,
        } as const);

  return (
    <VStack align="stretch" gap={6}>
      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <Heading size="sm">How will you connect?</Heading>
          <Text color="fg.muted" fontSize="sm">
            Pick whichever your identity provider gave you — most providers
            offer both, and either one works.
          </Text>
        </VStack>
        <IconRadioCardGroup
          ariaLabel="How will you connect?"
          value={protocol}
          onChange={(value) => setProtocol(value === "saml" ? "saml" : "oidc")}
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
      </VStack>

      <ServiceProviderDetails
        serviceProvider={serviceProvider}
        connected={false}
        protocol={protocol}
      />

      <VStack align="stretch" gap={3}>
        <Heading size="sm">Then tell us about it</Heading>
        <Field.Root>
          <Field.Label>Name</Field.Label>
          <Input
            placeholder="For example Okta"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          />
        </Field.Root>
        {protocol === "oidc" ? (
          <>
            <Field.Root>
              <Field.Label>Issuer address</Field.Label>
              <Input
                placeholder="https://acme.okta.com"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Client id</Field.Label>
              <Input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Client secret</Field.Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
              />
            </Field.Root>
          </>
        ) : (
          <>
            <Field.Root>
              <Field.Label>Sign-in address</Field.Label>
              <Input
                placeholder="Where your identity provider signs people in"
                value={entryPoint}
                onChange={(event) => setEntryPoint(event.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Metadata</Field.Label>
              <Textarea
                rows={4}
                placeholder="Paste the XML your identity provider exports"
                value={metadataXml}
                onChange={(event) => setMetadataXml(event.target.value)}
              />
            </Field.Root>
            <Text color="fg.muted" fontSize="sm">
              No metadata to paste? Give us these two instead.
            </Text>
            <Field.Root>
              <Field.Label>Entity id</Field.Label>
              <Input
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Signing certificate</Field.Label>
              <Textarea
                rows={4}
                placeholder="-----BEGIN CERTIFICATE-----"
                value={certificate}
                onChange={(event) => setCertificate(event.target.value)}
              />
            </Field.Root>
          </>
        )}
        <Button
          alignSelf="start"
          loading={register.isPending}
          onClick={() =>
            register.mutate(
              { organizationId, providerId, allowsJit: false, idp },
              {
                onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
                onError: reportRefusal,
              },
            )
          }
        >
          Register
        </Button>
      </VStack>
    </VStack>
  );
}
