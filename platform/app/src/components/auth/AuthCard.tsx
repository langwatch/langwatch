import { Box, Card, Container, Heading, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import "~/features/auth-front-door/authFrontDoor.css";
import { FullLogo } from "../icons/FullLogo";

/**
 * The card every unauthenticated screen is: the mark, one heading, one column
 * of content, all centred. The same component on every installation and at
 * every step, so a person moving between them sees one surface rather than a
 * series of pages that happen to look alike.
 *
 * The shape is the design board's, value for value: a 14 pixel surface about
 * 400 pixels wide, standing on a soft shadow, with the wordmark centred over a
 * plain semibold heading. The serif display voice belongs to the value panel
 * beside the card, never to the card itself.
 *
 * Responsive shape:
 *
 *   - on a phone it goes full bleed. A bordered card inset in a viewport that
 *     is barely wider than the card wastes the only space there is, and the
 *     border reads as a frame around nothing.
 *   - on anything larger it is a single centered card in a narrow column,
 *     because a log-in form is a short list of short fields and stretching it
 *     across a desktop makes each row a journey.
 */
export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Container
      maxW={{ base: "100%", sm: "400px" }}
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
        backgroundColor="bg.panel"
      >
        <Card.Header paddingTop="28px" paddingX="26px" paddingBottom={0}>
          <VStack gap="14px">
            {/* Named so the front door's entrance can measure it and land the
                mark it inherited from the loading screen here. The card's mark
                is the same wordmark the loading screen shows, so the flight
                ends on the very glyphs it started as. */}
            <Box data-auth-card-logo display="flex" justifyContent="center">
              <FullLogo width={112} height={27.5} />
            </Box>
            <Heading
              size="md"
              as="h1"
              fontWeight={600}
              letterSpacing="-0.015em"
              textAlign="center"
              css={{ textWrap: "balance" }}
            >
              {title}
            </Heading>
          </VStack>
        </Card.Header>
        <Card.Body paddingX="26px" paddingTop="16px" paddingBottom="28px">
          {/* Named for the same reason: the rows rise in behind the mark, and
              the stagger is applied from the stylesheet rather than by giving
              every screen an animation prop to pass down. */}
          <VStack width="full" align="stretch" gap="13px" data-auth-card-body>
            {children}
          </VStack>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
