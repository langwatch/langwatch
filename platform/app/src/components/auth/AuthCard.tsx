import {
  Box,
  Card,
  Container,
  Heading,
  HStack,
  VStack,
} from "@chakra-ui/react";
import type { ReactNode } from "react";

import { LogoIcon } from "../icons/LogoIcon";

/**
 * The card every unauthenticated screen is: logo, one heading, one column of
 * content. The same component on every installation and at every step, so a
 * person moving between them sees one surface rather than a series of pages
 * that happen to look alike.
 *
 * Responsive shape:
 *
 *   - on a phone it goes full bleed. A bordered card inset in a viewport that
 *     is barely wider than the card wastes the only space there is, and the
 *     border reads as a frame around nothing.
 *   - on anything larger it is a single centered card in a narrow column,
 *     because a log-in form is a short list of short fields and stretching it
 *     across a desktop makes each row a journey.
 *
 * Colors, borders and shadows come from the app's own tokens: this is the
 * product's front door, not a separate visual identity, so it follows the
 * theme (including its light and dark behavior) rather than pinning its own.
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
      maxW={{ base: "100%", sm: "440px" }}
      paddingX={{ base: 0, sm: 2 }}
      // High enough on the page to be the first thing seen, low enough that a
      // phone keyboard opening under it does not push the fields off screen.
      marginY={{ base: 6, md: "8vh" }}
    >
      <Card.Root
        width="full"
        borderWidth={{ base: 0, sm: "1px" }}
        borderRadius={{ base: 0, sm: "14px" }}
        boxShadow={{ base: "none", sm: "sm" }}
      >
        <Card.Header paddingBottom={2}>
          <HStack gap={4}>
            {/* Named so the front door's entrance can measure it and land the
                mark it inherited from the loading screen here. Nothing else
                reads it, and nothing about the card changes for it. */}
            <Box data-auth-card-logo display="flex" alignItems="center">
              <LogoIcon width={30.69} height={42} />
            </Box>
            <Heading
              size="lg"
              as="h1"
              // The site sets its headings in Sentient. The file is not in
              // this repository yet, so this lands on a real serif stack in
              // the same weight and tracking rather than on the body font.
              fontFamily='"Sentient", ui-serif, Georgia, "Times New Roman", serif'
              fontWeight={400}
              letterSpacing="-0.03em"
            >
              {title}
            </Heading>
          </HStack>
        </Card.Header>
        <Card.Body>
          {/* Named for the same reason: the rows rise in behind the mark, and
              the stagger is applied from the stylesheet rather than by giving
              every screen an animation prop to pass down. */}
          <VStack width="full" align="stretch" gap={4} data-auth-card-body>
            {children}
          </VStack>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
