import {
  Button,
  Heading,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { useState } from "react";
import { api } from "../../../utils/api";
import { reportRefusal } from "./refusals";
import { ServiceProviderDetails } from "./ServiceProviderDetails";

/**
 * Registering, once the other side exists.
 *
 * Two protocols behind one choice, and the choice is made in the customer's
 * words rather than ours: somebody who was handed a metadata file by their
 * security team does not necessarily know it is called SAML, and somebody
 * with a client id and secret does not necessarily know it is called OpenID
 * Connect. So the choice describes what they HAVE.
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
    <VStack align="stretch" gap={5}>
      <ServiceProviderDetails
        serviceProvider={serviceProvider}
        connected={false}
      />
      <VStack align="stretch" gap={3}>
        <Heading size="sm">Then tell us about it</Heading>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={protocol}
            onChange={(event) =>
              setProtocol(event.target.value === "saml" ? "saml" : "oidc")
            }
          >
            <option value="oidc">I have a client id and a client secret</option>
            <option value="saml">I have my identity provider's metadata</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Input
          placeholder="What to call it, for example Okta"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        />
        {protocol === "oidc" ? (
          <>
            <Input
              placeholder="Issuer address"
              value={issuer}
              onChange={(event) => setIssuer(event.target.value)}
            />
            <Input
              placeholder="Client id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
            <Input
              type="password"
              placeholder="Client secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </>
        ) : (
          <>
            <Input
              placeholder="Sign-in address"
              value={entryPoint}
              onChange={(event) => setEntryPoint(event.target.value)}
            />
            <Textarea
              rows={4}
              placeholder="Your identity provider's metadata"
              value={metadataXml}
              onChange={(event) => setMetadataXml(event.target.value)}
            />
            <Text color="fg.muted">
              No metadata to paste? Give us these two instead.
            </Text>
            <Input
              placeholder="Entity id"
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
            />
            <Textarea
              rows={4}
              placeholder="Signing certificate"
              value={certificate}
              onChange={(event) => setCertificate(event.target.value)}
            />
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
