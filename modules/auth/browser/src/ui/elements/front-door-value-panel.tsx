import "../../model/ambient.d.ts";
import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import { FullLogo } from "@langwatch/design-system/full-logo";
import type { ReactNode } from "react";

import "./auth-front-door.css";
import { FRONT_DOOR_GRADIENT, HEADING_FONT } from "../../model/front-door-theme.ts";

/** Value proposition panel; slots for headline, tagline, trust strip; hides on mobile. */
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
      className="lw-front-door-panel"
      position="relative"
      width={{ base: "full", md: "50%" }}
      flexShrink={0}
      display="flex"
      alignItems={{ base: "flex-start", md: "center" }}
      justifyContent={{ base: "center", md: "flex-start" }}
      paddingX={{ base: 6, md: "52px" }}
      paddingTop={{ base: 8, md: "56px" }}
      paddingBottom={{ base: 4, md: "56px" }}
      data-testid="front-door-value-panel"
    >
      <VStack
        position="relative"
        align={{ base: "center", md: "flex-start" }}
        textAlign={{ base: "center", md: "start" }}
        gap={{ base: 3, md: 6 }}
        maxWidth="640px"
        marginInlineStart={{ base: 0, md: "min(6vw, 72px)" }}
      >
        {/* The wordmark belongs to the PAGE, not to the card. Sitting in the
            card's header it read as a label on a form; above the headline it
            is the thing saying the sentence underneath it, which is what a
            wordmark is for. The card drops its own copy whenever this panel is
            on screen (`lw-front-door--split`), so it is never said twice. */}
        <Box data-testid="front-door-panel-logo" display="flex" marginBottom={{ base: 1, md: 2 }}>
          <FullLogo width={176} height={43.2} />
        </Box>
        <Heading
          as="h2"
          fontSize="clamp(30px, 3.1vw, 48px)"
          fontFamily={HEADING_FONT}
          fontWeight={400}
          // Tracking and leading respond to size, not breakpoints, via clamp().
          letterSpacing={{ base: "-0.018em", md: "-0.03em" }}
          lineHeight="clamp(38px, calc(18px + 2.1vw), 51px)"
          // The site's `.display` treatment, value for value: the subtle
          // vertical stretch and the ligatures are what make Sentient read
          // as the site's voice rather than merely the same file.
          css={{
            textWrap: "balance",
            scale: "1 1.1",
            fontVariantLigatures: "common-ligatures discretionary-ligatures contextual",
            fontKerning: "normal",
          }}
          data-testid="front-door-headline"
        >
          <AccentedHeadline text={headline} accent={headlineAccent} />
        </Heading>
        {tagline ? (
          // Set in the body face at reading size rather than as 12.5px mono.
          // The mono was the site's caption voice and it made the one line
          // arguing FOR the product read like a build log — small, technical,
          // and the least inviting thing on a page whose whole job is to
          // invite. It keeps a trace of the old treatment in its tracking.
          <Text
            display={{ base: "none", md: "block" }}
            fontSize="16px"
            lineHeight="1.6"
            letterSpacing="0.01em"
            maxWidth="42ch"
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

/** Renders headline with one word in gradient; handles \n breaks as authored line breaks. */
function AccentedHeadline({ text, accent }: { text: string; accent?: string }) {
  const withBreaks = (part: string, keyPrefix: string) => {
    const lines = part.split("\n");
    return lines.flatMap((line, index) =>
      index === 0 ? [line] : [<br key={`${keyPrefix}-${index}`} />, line],
    );
  };

  if (!accent) return <>{withBreaks(text, "line")}</>;

  const at = text.indexOf(accent);
  if (at === -1) return <>{withBreaks(text, "line")}</>;

  return (
    <>
      {withBreaks(text.slice(0, at), "before")}
      <Box
        as="span"
        backgroundImage={FRONT_DOOR_GRADIENT.accent}
        backgroundClip="text"
        color="transparent"
        paddingRight="0.04em"
        data-testid="front-door-headline-accent"
      >
        {accent}
      </Box>
      {withBreaks(text.slice(at + accent.length), "after")}
    </>
  );
}
