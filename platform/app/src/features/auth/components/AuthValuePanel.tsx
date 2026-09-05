import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { FullLogo } from "~/components/icons/FullLogo";
import "../auth.css";
import { AUTH_GRADIENT, HEADING_FONT } from "../authTheme";

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
export function AuthValuePanel({
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
      className="lw-auth-panel"
      position="relative"
      width={{ base: "full", md: "50%" }}
      flexShrink={0}
      display="flex"
      alignItems={{ base: "flex-start", md: "center" }}
      justifyContent={{ base: "center", md: "flex-start" }}
      // ONE horizontal inset, rather than a padding plus a margin on the block
      // inside it. The two used to stack — 52 pixels of padding and up to 72
      // more of start margin — and between them they took 124 pixels off a
      // half-width column, which is what squeezed a two-line headline into
      // three. The measure is the layout decision here; the indent is not.
      paddingX={{ base: 6, md: "clamp(40px, 4.4vw, 72px)" }}
      paddingTop={{ base: 8, md: "56px" }}
      paddingBottom={{ base: 4, md: "56px" }}
      data-testid="auth-screen-value-panel"
    >
      <VStack
        position="relative"
        align={{ base: "center", md: "flex-start" }}
        textAlign={{ base: "center", md: "start" }}
        // Spacing is set per element below, because the rhythm is not even:
        // the wordmark, the headline and the line under it are three different
        // sizes of thing and an equal gap between them reads as one lump.
        gap={0}
        // Wide enough to hold the written line break. Below this the headline
        // wraps a two-line sentence onto three, and a display serif that has
        // lost its own line breaks is the difference between a headline and a
        // paragraph in a big font.
        maxWidth={{ base: "34ch", md: "min(100%, 660px)" }}
        // Optically rather than geometrically centred: a block of type sits
        // low in its box when it is measured by arithmetic, because the
        // ascender space at the top reads as emptiness and the descender space
        // at the bottom does not. Lifting it by a twentieth of the viewport
        // puts it where the eye expects the centre to be, and it is a nudge
        // rather than a position — the block still moves with the panel.
        marginBottom={{ base: 0, md: "5vh" }}
      >
        {/* The wordmark belongs to the PAGE, not to the card. Sitting in the
            card's header it read as a label on a form; above the headline it
            is the thing saying the sentence underneath it, which is what a
            wordmark is for. The card drops its own copy whenever this panel is
            on screen (`lw-auth--split`), so it is never said twice.

            It stands clear of the headline rather than sitting on top of it:
            far enough to be the page's mark, near enough to still be the
            thing the sentence belongs to. */}
        <Box
          data-testid="auth-screen-panel-logo"
          display="flex"
          marginBottom={{ base: 5, md: "34px" }}
        >
          <FullLogo width={176} height={43.2} />
        </Box>
        <Heading
          as="h2"
          fontSize="clamp(30px, 3.1vw, 48px)"
          fontFamily={HEADING_FONT}
          fontWeight={400}
          // Tight tracking is a DISPLAY-size device, and it stays. Sub-1.1
          // leading was one too far: the old line box came out at about 1.08
          // times the type at full size, which is a setting for a face with
          // short extenders, and this one is a serif with long ones. Its
          // ascenders and descenders were closing on the lines above and
          // below, and three lines of it read as a solid block rather than as
          // three lines.
          //
          // So the leading opens, and it keeps opening as the type comes down,
          // because a wrapped headline at a narrow width needs more air than a
          // set one at display size — roughly 1.2x the type at the top of the
          // clamp and 1.3x at the bottom. It moves with the size rather than
          // at a breakpoint, so there is no width at which it jumps.
          letterSpacing={{ base: "-0.018em", md: "-0.03em" }}
          lineHeight="clamp(39px, calc(14px + 2.75vw), 56px)"
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
          data-testid="auth-screen-headline"
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
            // Answering the headline, not continuing it. It sat one step
            // closer than that and the two read as one paragraph whose second
            // half had lost its nerve — the gap is what makes the small line a
            // reply rather than a trailing clause.
            marginTop="26px"
            data-testid="auth-screen-tagline"
          >
            {tagline}
          </Text>
        ) : null}
        {trustStrip ? (
          <Box
            display={{ base: "none", md: "block" }}
            width="full"
            // The largest gap on the panel: everything above it is one voice
            // making one case, and this is somebody else's name under it.
            marginTop="44px"
            data-testid="auth-screen-trust"
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
        backgroundImage={AUTH_GRADIENT.accent}
        backgroundClip="text"
        color="transparent"
        paddingRight="0.04em"
        data-testid="auth-screen-headline-accent"
      >
        {accent}
      </Box>
      {withBreaks(text.slice(at + accent.length), "after")}
    </>
  );
}
