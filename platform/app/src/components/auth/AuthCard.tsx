import { Box, Card, Container, Heading, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import "~/features/auth-front-door/authFrontDoor.css";
import { FullLogo } from "../icons/FullLogo";

/**
 * The card every unauthenticated screen is: the mark, one heading, one column
 * of content. The same component on every installation and at every step, so
 * a person moving between them sees one surface rather than a series of pages
 * that happen to look alike.
 *
 * The surface is glass: a translucent 14 pixel card whose border and fill
 * come from the stylesheet's per-mode tokens, with the shell's ground
 * blurring through it — the same panel treatment the site's dark sections
 * use, and its light-glass counterpart on paper. The serif display voice
 * belongs to the value panel beside the card, never to the card itself.
 *
 * Alignment is one rule, applied throughout: the identity block (mark and
 * heading) is centred, and everything a person reads or operates below it is
 * a full-width left-aligned column. Footers that are a single line of prose
 * centre themselves; nothing else does.
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
        <Card.Header paddingTop="30px" paddingX="28px" paddingBottom={0}>
          <VStack gap="16px">
            {/* Named so the entrance can address the identity block: the same
                wordmark the loading screen shows, settling in place. */}
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
        <Card.Body paddingX="28px" paddingTop="18px" paddingBottom="30px">
          {/* Named for the entrance: the rows rise in one after another, and
              the stagger is applied from the stylesheet rather than by giving
              every screen an animation prop to pass down. */}
          <VStack width="full" align="stretch" gap="14px" data-auth-card-body>
            {children}
          </VStack>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
