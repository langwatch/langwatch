/**
 * `/authorize` — copy this project's API key into a terminal or a notebook.
 *
 * Two things changed and both are the application's. `DashboardLayout` is drawn
 * by the chrome layout route above every page `apps/ui` serves, so rendering it
 * here would give the address two of everything. And the key is asked for by
 * name: `revealProjectApiKey()` rather than a field on the scope reading — see
 * `model/authorize-host` for why a credential is never carried on a scope.
 *
 * `trackEvent("api_key_copy")` did NOT travel. Product analytics is the
 * application's, and a port method the host could only answer with nothing is
 * worse than its absence — the line the navigation family drew for
 * `trackEvent("navigation_product_switch")`.
 */

import { Card, Container, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { useAuthorizeHost } from "../../model/authorize-host";
import { CopyInput } from "../../ui/elements/copy-input";

export default function Authorize() {
  const host = useAuthorizeHost();

  return (
    <Container maxWidth="600px" paddingTop="200px">
      <Card.Root>
        <Card.Header>
          <HStack width="full" align="center">
            <Heading as="h1" size="md">
              Authorize
            </Heading>
            <Spacer />
            {host.projectSwitcher()}
          </HStack>
        </Card.Header>
        <Card.Body>
          <VStack align="start" gap={6}>
            <Text>
              Copy your LangWatch API key below and paste it into your command line or notebook to
              authorize it.
            </Text>
            <APIKeyCopyInput />
          </VStack>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}

export function APIKeyCopyInput() {
  const host = useAuthorizeHost();
  return <CopyInput value={host.revealProjectApiKey() ?? ""} label="API key" />;
}
