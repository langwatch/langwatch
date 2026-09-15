/** Simplified 404 scene for governance pages behind feature flags. */

import { Button, Center, Heading, Stack, Text } from "@chakra-ui/react";
import { useGovernanceHost } from "../../model/governance-host.ts";

export function NotFoundScene() {
  const host = useGovernanceHost();

  return (
    <Center minHeight="60vh" padding={8}>
      <Stack gap={4} align="center" maxWidth="480px" textAlign="center">
        <Heading size="lg">This page is not here</Heading>
        <Text color="fg.muted">
          The address is wrong, or this part of LangWatch is not switched on for your organization.
        </Text>
        <Button variant="outline" onClick={() => host.navigate("/")}>
          Go to the dashboard
        </Button>
      </Stack>
    </Center>
  );
}
