import { Box, Button, Card, Container, HStack, Spacer } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { LogOut } from "react-feather";
import { useOnboardingHost } from "../../model/onboarding-host";

/**
 * The frame the signed-out-ish setup pages sit in.
 *
 * TWO THINGS CHANGED AND BOTH ARE THE APPLICATION'S. Signing out is one
 * identity client per document and a feature package may not construct one, so
 * it is asked of the host. And the `<title>` did not travel: `<Head>` was the
 * application's compatibility shim for a framework this application does not
 * run, and setting a document title from a layout is the `documentTitle`
 * capability's job — the same silent drop the gateway, governance and front-door
 * families each recorded.
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
