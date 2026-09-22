// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What an organization sees when it already signs in through a provider that
 * predates connections.
 *
 * It used to see the vendor picker, because "no connection" meant both
 * "nobody has set this up" and "this was set up years ago and is routing
 * people right now". Following that invitation built a SECOND connection
 * beside the live one, with no predecessor, no inherited proof and no way
 * back. Moving the old route onto a connection is something LangWatch does,
 * so this says the setup exists and stops offering a rival to it.
 */
import { Alert, HStack, Text, VStack } from "@chakra-ui/react";

import { providerDisplayName } from "../../model/provider-display-name.ts";

export function LegacyRouteNotice({
  legacyRoute,
}: {
  legacyRoute: { domain: string; provider: string };
}) {
  const provider = providerDisplayName(legacyRoute.provider);

  return (
    <Alert.Root status="info" data-testid="sso-legacy-route">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Single sign-on is already set up</Alert.Title>
        <Alert.Description>
          Everyone with an address at this domain already signs in through your identity provider,
          so there is nothing to set up here. Get in touch if you want to change how your
          organization signs in.
        </Alert.Description>
        <VStack align="stretch" gap={1} paddingTop={2}>
          <LegacyRouteRow label="Domain">{legacyRoute.domain}</LegacyRouteRow>
          {/* Only when we can spell it. The stored value is an identifier, and
              a row reading "Identity provider: auth0" shows the customer our
              database rather than their provider. */}
          {provider && <LegacyRouteRow label="Identity provider">{provider}</LegacyRouteRow>}
        </VStack>
      </Alert.Content>
    </Alert.Root>
  );
}

function LegacyRouteRow({ label, children }: { label: string; children: string }) {
  return (
    <HStack gap={2} justify="space-between">
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </HStack>
  );
}
