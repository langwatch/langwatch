import { Heading, Text, VStack } from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { CopyValueRows } from "../CopyValueRows";

/**
 * What LangWatch is, to somebody about to configure their identity provider
 * (D09).
 *
 * BEFORE a single field is asked for, because the order is the order the work
 * happens in: an administrator sets an application up in their identity
 * provider, and to do that they need these values. A form that only asked
 * them questions would send them away to guess, and the values they would
 * guess are ours.
 *
 * ONLY the chosen protocol's values. OpenID Connect needs one address and
 * SAML needs three, and a screen that showed all four regardless read as a
 * wall of URLs where every reader had to work out which lines were theirs.
 * The protocol choice above this section is what scopes it.
 */
export function ServiceProviderDetails({
  serviceProvider,
  connected,
  protocol,
}: {
  serviceProvider: SelfServeSetupView["serviceProvider"];
  connected: boolean;
  protocol: "oidc" | "saml";
}) {
  const rows =
    protocol === "oidc"
      ? [
          {
            label: "Redirect address",
            hint: "Where your identity provider sends people back to",
            value: serviceProvider.redirectUrl,
          },
        ]
      : [
          {
            label: "Assertion address",
            hint: "Where your identity provider posts the signed assertion",
            value: serviceProvider.assertionConsumerServiceUrl,
          },
          {
            label: "Entity id",
            hint: "What to call LangWatch in your identity provider",
            value: serviceProvider.entityId,
          },
          {
            label: "Service provider metadata",
            hint: "Import this address if your identity provider takes one",
            value: serviceProvider.metadataUrl,
          },
        ];

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={1}>
        <Heading size="sm">Set LangWatch up in your identity provider</Heading>
        <Text color="fg.muted" fontSize="sm">
          {rows.length === 1
            ? "Create an application there and give it this address. It is ours and it does not change."
            : "Create an application there and give it these values. They are ours and they do not change."}
          {!connected && (
            <>
              {" "}
              The part shown as <code>{"{connection}"}</code> is filled in once
              you register below, so come back for the finished{" "}
              {rows.length === 1 ? "address" : "addresses"}.
            </>
          )}
        </Text>
      </VStack>
      <CopyValueRows rows={rows} />
    </VStack>
  );
}
