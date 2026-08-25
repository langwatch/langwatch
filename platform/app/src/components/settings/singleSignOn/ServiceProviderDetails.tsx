import { Heading, Text, VStack } from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { CopyInput } from "../../CopyInput";

/**
 * What LangWatch is, to somebody about to configure their identity provider
 * (D09).
 *
 * FIRST on the screen and before a single field is asked for, because the
 * order is the order the work happens in: an administrator sets an
 * application up in their identity provider, and to do that they need these
 * values. A form that only asked them questions would send them away to
 * guess, and the values they would guess are ours.
 */
export function ServiceProviderDetails({
  serviceProvider,
  connected,
}: {
  serviceProvider: SelfServeSetupView["serviceProvider"];
  connected: boolean;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <Heading size="sm">Set LangWatch up in your identity provider</Heading>
      <Text color="fg.muted">
        Create an application there and give it these values. They are ours and
        they do not change.
        {!connected && (
          <>
            {" "}
            The part shown as <code>{"{connection}"}</code> is filled in once
            you register below, so come back for the finished addresses.
          </>
        )}
      </Text>
      <CopyInput
        value={serviceProvider.redirectUrl}
        label="Redirect address, for OpenID Connect"
      />
      <CopyInput
        value={serviceProvider.assertionConsumerServiceUrl}
        label="Assertion address, for SAML"
      />
      <CopyInput value={serviceProvider.entityId} label="LangWatch's name" />
      <CopyInput
        value={serviceProvider.metadataUrl}
        label="LangWatch's published details, for SAML"
      />
    </VStack>
  );
}
