import "../../model/ambient.d.ts";
import { Box, Card, Container, Heading, Text, VStack } from "@chakra-ui/react";
import { FullLogo } from "@langwatch/design-system/full-logo";

import "./auth-front-door.css";
import type { ReactNode } from "react";

/** Glass card container for all auth screens; centered on desktop, full-bleed on mobile. */
export function AuthCard({
  title,
  intro,
  finePrint,
  children,
}: {
  title: string;
  /** One quiet line answering the heading. Part of the identity block:
   *  centred and balanced with it, never a row of the form below. */
  intro?: string;
  /** The small print under everything: terms, privacy, nothing louder. */
  finePrint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Container
      maxW={{ base: "100%", sm: "408px" }}
      paddingX={{ base: 0, sm: 2 }}
      // High enough on the page to be the first thing seen, low enough that a
      // phone keyboard opening under it does not push the fields off screen.
      marginY={{ base: 6, md: "8vh" }}
    >
      <Card.Root
        className="lw-front-door-card"
        width="full"
        borderWidth={{ base: 0, sm: "1px" }}
        borderRadius={{ base: 0, sm: "14px" }}
        data-auth-card
      >
        <Card.Header paddingTop="34px" paddingX="32px" paddingBottom={0}>
          <VStack gap="12px">
            {/* Named so the entrance can address the identity block: the same
                wordmark the loading screen shows, settling in place. */}
            <Box data-auth-card-logo display="flex" justifyContent="center">
              <FullLogo width={112} height={27.5} />
            </Box>
            <Heading
              as="h1"
              fontSize="19px"
              fontWeight={600}
              letterSpacing="-0.015em"
              textAlign="center"
              css={{ textWrap: "balance" }}
            >
              {title}
            </Heading>
            {intro ? (
              <Text
                fontSize="13.5px"
                lineHeight="1.55"
                color="fg.muted"
                textAlign="center"
                maxWidth="36ch"
                marginTop="-4px"
                css={{ textWrap: "balance" }}
              >
                {intro}
              </Text>
            ) : null}
          </VStack>
        </Card.Header>
        <Card.Body paddingX="32px" paddingTop="22px" paddingBottom="32px">
          {/* Named for the entrance: the rows rise in one after another, and
              the stagger is applied from the stylesheet rather than by giving
              every screen an animation prop to pass down. */}
          <VStack width="full" align="stretch" gap="14px" data-auth-card-body>
            {children}
          </VStack>
          {finePrint ? (
            <Box paddingTop="18px" textAlign="center">
              {finePrint}
            </Box>
          ) : null}
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
