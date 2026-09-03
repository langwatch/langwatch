/**
 * The address that is not a page.
 *
 * `platform/app`'s `NotFoundScene` is 486 lines of canvas art over a 439-line
 * renderer, and it reads `process.env.NODE_ENV` to offer its parameter sliders —
 * an import a feature-web package may not make at all. So what travels is the
 * message and the way out, and the art stays behind until the scene itself
 * moves with the shell that owns 404 for every route rather than for this one.
 *
 * Reached when a governance page is behind a flag that is off: the address
 * exists in the route table, and this deployment does not serve it.
 */

import { Button, Center, Heading, Stack, Text } from "@chakra-ui/react";
import { useGovernanceHost } from "../../model/governance-host";

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
