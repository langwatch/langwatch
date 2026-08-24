import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import "../authFrontDoor.css";
import { HEADING_FONT, MONO_FONT } from "../logic/brand";
import { FrontDoorMesh } from "./FrontDoorMesh";

/**
 * The case the hosted product makes, next to the door rather than inside it.
 *
 * Everything here is a slot the shell fills, and none of it is in the auth
 * card: the card that authenticates a person is the same component on every
 * installation, and this panel is simply not rendered on one that has nothing
 * to sell.
 *
 * The panel is the one surface that speaks in the site's display voice: the
 * serif headline with its single gradient word, the mono tagline, the mesh
 * band breathing behind them, and a few quiet trace lines along the floor.
 *
 * On a narrow viewport the panel gives up everything but the headline. A
 * tagline and a trusted-by row above a log-in form on a phone are two screens
 * of scrolling in front of the thing the person came to do.
 */
export function FrontDoorValuePanel({
  headline,
  headlineAccent,
  tagline,
  trustStrip,
}: {
  headline: string;
  /** The one word in the headline that carries the gradient. */
  headlineAccent?: string;
  tagline?: string;
  /** Empty until there is something true to put in it. */
  trustStrip?: ReactNode;
}) {
  return (
    <Box
      position="relative"
      width={{ base: "full", md: "50%" }}
      flexShrink={0}
      display="flex"
      alignItems={{ base: "flex-start", md: "center" }}
      justifyContent={{ base: "center", md: "flex-start" }}
      paddingX={{ base: 6, md: "52px" }}
      paddingTop={{ base: 8, md: "56px" }}
      paddingBottom={{ base: 4, md: "56px" }}
      borderInlineEndWidth={{ base: 0, md: "1px" }}
      borderColor="border"
      overflow="hidden"
      data-testid="front-door-value-panel"
    >
      <FrontDoorMesh protect="left" />
      <TraceLines />
      <VStack
        position="relative"
        zIndex={2}
        align={{ base: "center", md: "flex-start" }}
        textAlign={{ base: "center", md: "start" }}
        gap={{ base: 3, md: 5 }}
        maxWidth="520px"
        marginInlineStart={{ base: 0, md: "min(6vw, 72px)" }}
      >
        <Heading
          as="h2"
          fontSize="clamp(28px, 3.6vw, 44px)"
          fontFamily={HEADING_FONT}
          fontWeight={400}
          letterSpacing="-0.03em"
          lineHeight="1.02"
          css={{ textWrap: "balance" }}
          data-testid="front-door-headline"
        >
          <AccentedHeadline text={headline} accent={headlineAccent} />
        </Heading>
        {tagline ? (
          <Text
            display={{ base: "none", md: "block" }}
            fontFamily={MONO_FONT}
            fontSize="12px"
            letterSpacing="0.02em"
            lineHeight="1.7"
            maxWidth="40ch"
            color="fg.muted"
            data-testid="front-door-tagline"
          >
            {tagline}
          </Text>
        ) : null}
        {trustStrip ? (
          <Box
            display={{ base: "none", md: "block" }}
            width="full"
            paddingTop={4}
            data-testid="front-door-trust"
          >
            {trustStrip}
          </Box>
        ) : null}
      </VStack>
    </Box>
  );
}

/**
 * Three quiet spans along the panel's floor, in the band's own colours: the
 * product's trace waterfalls, abstracted to a whisper. Decorative only, and
 * only where there is a floor to sit on.
 */
function TraceLines() {
  return (
    <Box
      display={{ base: "none", md: "block" }}
      position="absolute"
      left={0}
      right={0}
      bottom={0}
      height="120px"
      width="full"
      zIndex={1}
      opacity={0.5}
      pointerEvents="none"
      aria-hidden="true"
      asChild
    >
      <svg viewBox="0 0 600 120" preserveAspectRatio="none">
        <path
          d="M0 90 C150 60 300 118 600 74"
          fill="none"
          stroke="#f56b1a"
          strokeWidth="1"
          opacity="0.35"
        />
        <path
          d="M0 104 C180 80 340 128 600 92"
          fill="none"
          stroke="#99988f"
          strokeWidth="1"
          opacity="0.3"
        />
        <path
          d="M0 76 C160 48 320 104 600 58"
          fill="none"
          stroke="#cddcf9"
          strokeWidth="1.5"
          opacity="0.7"
        />
      </svg>
    </Box>
  );
}

/**
 * One word of the headline carries the gradient. Split rather than authored as
 * markup so the copy stays a single string a writer can change without
 * touching a component, and so a headline whose accent word is not in it still
 * renders the whole headline.
 */
function AccentedHeadline({ text, accent }: { text: string; accent?: string }) {
  if (!accent) return <>{text}</>;

  const at = text.indexOf(accent);
  if (at === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, at)}
      <Box
        as="span"
        backgroundImage="linear-gradient(100deg, #2563eb 0%, #d9531e 100%)"
        backgroundClip="text"
        color="transparent"
        paddingRight="0.04em"
        data-testid="front-door-headline-accent"
      >
        {accent}
      </Box>
      {text.slice(at + accent.length)}
    </>
  );
}
