/// <reference path="../../model/ambient.d.ts" />
import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { FullLogo } from "./full-logo";
import "./auth-front-door.css";
import { FRONT_DOOR_GRADIENT, HEADING_FONT } from "../../model/front-door-theme";

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
        maxWidth="640px"
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
          <FullLogo width={176} height={43.2} />
        </Box>
        <Heading
          as="h2"
          fontSize="clamp(30px, 3.1vw, 48px)"
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
          lineHeight="clamp(38px, calc(18px + 2.1vw), 51px)"
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

/**
 * One word of the headline carries the gradient. Split rather than authored as
 * markup so the copy stays a single string a writer can change without
 * touching a component, and so a headline whose accent word is not in it still
 * renders the whole headline.
 *
 * A `\n` in the copy is a deliberate line break. `text-wrap: balance` breaks
 * where the maths says, and the maths does not know a phrase from a hole in
 * the ground — it gave the sign-in headline a stranded two-word middle line.
 * A display headline's breaks are part of the writing, so the writer sets
 * them, and balance stays only as the fallback for a width where the written
 * lines no longer fit.
 */
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
