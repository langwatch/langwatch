import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import "../authFrontDoor.css";
import { HEADING_FONT } from "../logic/brand";

/**
 * The ground the front door stands on.
 *
 * The card itself is the same on every installation, byte for byte: nothing
 * inside it asks which deployment it is running on. What differs is what
 * surrounds it, and that is composed here — a hosted signup has a pitch to
 * make, and a company's own installation does not.
 *
 * The enrichments are SLOTS rather than branches. Marketing fills them
 * without touching a component that authenticates anybody, and an
 * installation that renders none of them renders exactly a heading, a card and
 * a link.
 */
export function FrontDoorShell({
  headline,
  subheadline,
  trustStrip,
  children,
}: {
  /** Shown above the card on hosted surfaces. */
  headline?: string;
  subheadline?: string;
  /** Shown below the card on hosted surfaces. Empty until there is something
   *  true to put in it: an invented customer logo is worse than a gap. */
  trustStrip?: ReactNode;
  children: ReactNode;
}) {
  const publicEnv = usePublicEnv();
  const isHosted = publicEnv.data?.IS_SAAS === true;

  return (
    <Box
      className="lw-front-door"
      position="relative"
      backgroundColor="bg.subtle"
      minHeight="100vh"
      width="full"
      overflowX="hidden"
    >
      {isHosted ? (
        <div
          className="lw-front-door-ambient"
          data-testid="front-door-ambient"
        />
      ) : null}
      <VStack
        position="relative"
        zIndex={1}
        width="full"
        gap={6}
        paddingX={{ base: 4, md: 6 }}
        paddingTop={{ base: 6, md: "6vh" }}
        paddingBottom={10}
      >
        {isHosted && headline ? (
          <VStack gap={2} maxWidth="440px" textAlign="center">
            <Heading
              as="h2"
              size="lg"
              fontFamily={HEADING_FONT}
              fontWeight={400}
              letterSpacing="-0.03em"
              data-testid="front-door-headline"
            >
              {headline}
            </Heading>
            {subheadline ? (
              <Text color="gray.600" fontSize="sm">
                {subheadline}
              </Text>
            ) : null}
          </VStack>
        ) : null}
        {children}
        {isHosted && trustStrip ? (
          <Box maxWidth="440px" width="full" data-testid="front-door-trust">
            {trustStrip}
          </Box>
        ) : null}
      </VStack>
    </Box>
  );
}
