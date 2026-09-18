import "../../model/ambient.d.ts";
import { Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import "../elements/auth-front-door.css";
import { CastleSnake } from "../elements/castle-snake.tsx";
import { FrontDoorGround } from "./front-door-ground.tsx";
import { FrontDoorValuePanel } from "../elements/front-door-value-panel.tsx";
import { LogoHandoff } from "./logo-handoff.tsx";

/**
 * Front door layout ground; hosted vs self-hosted compose different surroundings around same card
 */
export function FrontDoorShell({
  headline,
  headlineAccent,
  tagline,
  trustStrip,
  children,
}: {
  /** Shown beside (or above) the card on hosted surfaces. */
  headline?: string;
  /** The one word of the headline that carries the gradient. */
  headlineAccent?: string;
  /** A short line under the headline, in the mono face. Desktop only. */
  tagline?: string;
  /** Shown under the panel on hosted desktops. Empty until there is something
   *  true to put in it: an invented customer logo is worse than a gap. */
  trustStrip?: ReactNode;
  children: ReactNode;
}) {
  const publicEnv = usePublicEnv();
  const isHosted = publicEnv.data?.IS_SAAS === true;

  return (
    <Box
      // The modifier says the value panel is on screen, which is the one thing
      // the card needs to know without being told: it drops its own wordmark
      // so the page says it once, above the headline.
      className={isHosted && headline ? "lw-front-door lw-front-door--split" : "lw-front-door"}
      position="relative"
      backgroundColor="frontDoor.ground"
      minHeight="100vh"
      width="full"
      overflowX="hidden"
    >
      <LogoHandoff />
      {/* Renders nothing until somebody double-taps the castle. Mounted here
          so it exists exactly where the front door exists — same flag, same
          screens — and nowhere else. */}
      <CastleSnake />
      {isHosted ? <FrontDoorGround protect={headline ? "left" : "center"} /> : null}
      {isHosted && headline ? (
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
          minHeight="100vh"
          width="full"
          maxWidth="1440px"
          marginX="auto"
        >
          <FrontDoorValuePanel
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
            data-testid="front-door-card-column"
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
          justify={{ base: "flex-start", md: "center" }}
          minHeight="100vh"
          width="full"
          paddingX={{ base: 0, sm: 4 }}
          paddingBottom={10}
          data-testid="front-door-card-column"
        >
          {children}
        </Flex>
      )}
    </Box>
  );
}
