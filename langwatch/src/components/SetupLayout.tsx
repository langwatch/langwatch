import {
  Box,
  Card,
  Container,
  HStack,
  Spacer,
  Button,
} from "@chakra-ui/react";
import Head from "next/head";
import { type PropsWithChildren } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "react-feather";

export const SetupLayout = ({
  children,
  maxWidth = "780px",
}: PropsWithChildren<{ maxWidth?: string }>) => {
  return (
    <Box
      width="full"
      height="full"
      minHeight="100vh"
      backgroundColor="gray.300"
      paddingTop={16}
    >
      <Head>
        <title>LangWatch - Setup</title>
      </Head>
      <HStack position="fixed" top={2} right={2} zIndex={99}>
        <Spacer />
        <Button variant="ghost" onClick={() => void signOut()}>
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
