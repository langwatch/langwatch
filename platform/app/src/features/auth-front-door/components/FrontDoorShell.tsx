import { Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import "../authFrontDoor.css";
import { FrontDoorValuePanel } from "./FrontDoorValuePanel";
import { LogoHandoff } from "./LogoHandoff";

/**
 * The ground the front door stands on.
 *
 * The card itself is the same on every installation, byte for byte: nothing
 * inside it asks which deployment it is running on. What differs is what
 * surrounds it, and that is composed here — a hosted signup has a case to
 * make, and a company's own installation does not.
 *
 * Hosted, on a desktop, that case gets its own half of the page: headline,
 * tagline and the trusted-by slot on the left, over the mesh band, with the
 * card on the right behind a hairline. Below the split it collapses to the
 * headline above the card, because a tagline and a logo row stacked above a
 * log-in form on a phone are two screens of scrolling in front of the thing
 * the person came to do.
 *
 * Self-hosted is the plain centred card, on its own, with nothing sold beside
 * it.
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
      className="lw-front-door"
      position="relative"
      backgroundColor="bg.subtle"
      minHeight="100vh"
      width="full"
      overflowX="hidden"
    >
      <LogoHandoff />
      {isHosted && headline ? (
        <Flex
          direction={{ base: "column", md: "row" }}
          align="stretch"
          minHeight="100vh"
          width="full"
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
          direction="column"
          align="center"
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
