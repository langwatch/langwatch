// /authorize: copy project API key. No DashboardLayout (chrome route draws it above). Key asked
// by name; trackEvent("api_key_copy") is app's.

import { Card, Container, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";

import { useAuthorizeHost } from "../../model/authorize-host.ts";
import { CopyInput } from "../elements/copy-input.tsx";

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
