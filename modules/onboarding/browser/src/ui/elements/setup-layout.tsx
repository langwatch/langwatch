import { Box, Button, Card, Container, HStack, Spacer } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { LogOut } from "react-feather";

import { useOnboardingHost } from "../../model/onboarding-host.ts";

/**
 * Frame for setup pages; delegates signing out and document title to the host.
 */
export const SetupLayout = ({
  children,
  maxWidth = "780px",
}: PropsWithChildren<{ maxWidth?: string }>) => {
  const host = useOnboardingHost();
  return (
    <Box width="full" height="full" minHeight="100vh" backgroundColor="gray.300" paddingTop={16}>
      <HStack position="fixed" top={2} right={2} zIndex={99}>
        <Spacer />
        <Button variant="ghost" onClick={() => host.signOut()}>
          <LogOut />
        </Button>
      </HStack>
      <Container maxWidth={maxWidth}>
        <Card.Root>
          <Card.Body>{children}</Card.Body>
        </Card.Root>
      </Container>
    </Box>
  );
};
