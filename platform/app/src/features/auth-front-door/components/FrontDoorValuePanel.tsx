import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { FullLogo } from "~/components/icons/FullLogo";
import "../authFrontDoor.css";
import { HEADING_FONT, MONO_FONT } from "../logic/brand";

/**
 * The case the hosted product makes, next to the door rather than inside it.
 *
 * Everything here is a slot the shell fills, and none of it is in the auth
 * card: the card that authenticates a person is the same component on every
 * installation, and this panel is simply not rendered on one that has nothing
 * to sell.
 *
 * The panel owns no ground of its own — it reads directly off the shell's
 * field, standing on the side the ground keeps clean. What it owns is the
 * site's display voice: the serif headline with its single gradient word and
 * the mono tagline. The gradient is the mode's own cut — blue-into-orange on
 * paper, the lifted pair on ink — via the stylesheet token.
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
        maxWidth="520px"
        marginInlineStart={{ base: 0, md: "min(6vw, 72px)" }}
      >
        {/* The wordmark belongs to the PAGE, not to the card. Sitting in the
            card's header it read as a label on a form; above the headline it
            is the thing saying the sentence underneath it, which is what a
            wordmark is for. The card drops its own copy whenever this panel is
            on screen (`lw-front-door--split`), so it is never said twice. */}
        <Box
          data-testid="front-door-panel-logo"
          display="flex"
          marginBottom={{ base: 1, md: 2 }}
        >
          <FullLogo width={132} height={32.4} />
        </Box>
        <Heading
          as="h2"
          fontSize="clamp(30px, 3.4vw, 52px)"
          fontFamily={HEADING_FONT}
          fontWeight={400}
          // Tight tracking and sub-1 leading are DISPLAY-size devices. The
          // headline is the same sentence at every width, so a narrow viewport
          // does not shrink it — it wraps it, and three tight lines become
          // five, which is when 0.98 stops reading as confident and starts
          // reading as squashed.
          //
          // So both open up as the type comes down, and they do it with the
          // size rather than at a breakpoint: the line box has its own clamp,
          // rising from ~1.27x the type at the small end to ~1.02x at full
          // display size. Between them it is always the right leading for the
          // size actually rendered, and there is no width at which it jumps.
          letterSpacing={{ base: "-0.018em", md: "-0.03em" }}
          lineHeight="clamp(38px, calc(18px + 2.3vw), 54px)"
          // The site's `.display` treatment, value for value: the subtle
          // vertical stretch and the ligatures are what make Sentient read
          // as the site's voice rather than merely the same file.
          css={{
            textWrap: "balance",
            scale: "1 1.1",
            fontVariantLigatures:
              "common-ligatures discretionary-ligatures contextual",
            fontKerning: "normal",
          }}
          data-testid="front-door-headline"
        >
          <AccentedHeadline text={headline} accent={headlineAccent} />
        </Heading>
        {tagline ? (
          <Text
            display={{ base: "none", md: "block" }}
            fontFamily={MONO_FONT}
            fontSize="12.5px"
            letterSpacing="0.02em"
            lineHeight="1.7"
            maxWidth="44ch"
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
        backgroundImage="var(--lw-front-door-accent-gradient)"
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
