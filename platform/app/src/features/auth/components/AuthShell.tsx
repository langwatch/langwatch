import { Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";
import "../auth.css";
import { AuthGround } from "./AuthGround";
import { AuthValuePanel } from "./AuthValuePanel";
import { CastleSnake } from "./CastleSnake";
import { LogoHandoff } from "./LogoHandoff";

/**
 * The ground the auth screens stands on.
 *
 * The card itself is the same on every installation, byte for byte: nothing
 * inside it asks which deployment it is running on. Neither, any more, does
 * the room around it: the ground and the panel used to be hosted-only, and a
 * company's own installation got a plain centred card on plain paper — which
 * read as an unstyled page rather than as restraint. One door, one design,
 * whoever runs it.
 *
 * The whole viewport is ONE field — the site's light mesh or its dark warp,
 * depending on the colour mode — and everything sits over it: the headline
 * reads off the ground's protected side, and the card is glass with the same
 * ground moving through it. There is no border and no change of surface
 * between the two halves, because there are no two surfaces; a seam down the
 * middle of one field was the old layout's bug. A screen with no headline —
 * an error page, a reset form — keeps the field and centres the card on it.
 */
export function AuthShell({
  headline,
  headlineAccent,
  tagline,
  trustStrip,
  fillContainer = false,
  children,
}: {
  /** Shown beside (or above) the card. */
  headline?: string;
  /** The one word of the headline that carries the gradient. */
  headlineAccent?: string;
  /** A short line under the headline, in the mono face. Desktop only. */
  tagline?: string;
  /** Shown under the panel on desktops. Empty until there is something
   *  true to put in it: an invented customer logo is worse than a gap. */
  trustStrip?: ReactNode;
  /** Fit a signed-in page's content area while keeping its navigation available. */
  fillContainer?: boolean;
  children: ReactNode;
}) {
  const minimumHeight = fillContainer ? 0 : "100vh";
  return (
    <Box
      // The modifier says the value panel is on screen, which is the one thing
      // the card needs to know without being told: it drops its own wordmark
      // so the page says it once, above the headline.
      className={headline ? "lw-auth lw-auth--split" : "lw-auth"}
      position="relative"
      backgroundColor="auth.ground"
      minHeight={minimumHeight}
      flex={fillContainer ? 1 : void 0}
      display="flex"
      flexDirection="column"
      width="full"
      overflowX="hidden"
    >
      <LogoHandoff />
      {/* Renders nothing until somebody double-taps the castle. Mounted here
          so it exists exactly where the auth screens exists — same flag, same
          screens — and nowhere else. */}
      <CastleSnake />
      <AuthGround protect={headline ? "left" : "center"} />
      {headline ? (
        // Capped at the site's content width and centred, so a big monitor
        // widens the field around the conversation rather than flinging the
        // headline and the card to opposite edges of it. Both doors keep the
        // same seats — words on the left, card on the right — so crossing
        // between them only changes what is said, never where anything is.
        <Flex
          position="relative"
          zIndex={1}
          direction={{ base: "column", md: "row" }}
          align="stretch"
          minHeight={minimumHeight}
          flex={1}
          width="full"
          maxWidth="1440px"
          marginX="auto"
        >
          <AuthValuePanel
            headline={headline}
            headlineAccent={headlineAccent}
            tagline={tagline}
            trustStrip={trustStrip}
          />
          <Flex
            flex="1"
            justify="center"
            align={{ base: "flex-start", md: "center" }}
            paddingX={{ base: 0, sm: 4, md: 10 }}
            paddingBottom={10}
            data-testid="auth-screen-card-column"
          >
            {children}
          </Flex>
        </Flex>
      ) : (
        <Flex
          position="relative"
          zIndex={1}
          direction="column"
          align="center"
          justify={
            fillContainer ? "center" : { base: "flex-start", md: "center" }
          }
          minHeight={minimumHeight}
          flex={1}
          width="full"
          paddingX={{ base: 0, sm: 4 }}
          paddingBottom={10}
          data-testid="auth-screen-card-column"
        >
          {children}
        </Flex>
      )}
    </Box>
  );
}
