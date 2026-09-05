import { Box, chakra, Flex, Grid, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { HEADING_FONT } from "~/features/auth-front-door/frontDoorTheme";
import {
  GUIDED_PATH_DESCRIPTIONS,
  GUIDED_PATH_TITLES,
  GUIDED_PATHS,
  type GuidedPath,
} from "../paths";
import { valueSegments } from "./copy";
import { NextButton } from "./NextButton";
import { TakeoverRow } from "./TakeoverRow";
import { Typewriter } from "./Typewriter";

/**
 * "What are the most valuable things we can set up for you today?": four
 * cards in a 2x2 grid, multi-pick, a rounded square checkbox top-right that
 * fills orange with the pick order. The order carries meaning: the first
 * pick is what Langy sets up now.
 */

const PATH_ICONS: Record<GuidedPath, string> = {
  llmops: "/images/onboarding/guided/icon-evals.png",
  coding: "/images/external-icons/claude-code.svg",
  gateway: "/images/onboarding/guided/icon-gateway.png",
  governance: "/images/onboarding/guided/icon-governance.png",
};

export function ValueScreen({
  firstName,
  target,
  initialPicks = [],
  fading,
  onNext,
}: {
  firstName: string;
  /** Who this is for: the organization name, or "you". */
  target: string;
  initialPicks?: GuidedPath[];
  fading: boolean;
  onNext: (paths: GuidedPath[]) => void;
}) {
  const { emit } = useAnalytics();
  const [typed, setTyped] = useState(false);
  const [picks, setPicks] = useState<GuidedPath[]>(initialPicks);

  useEffect(() => {
    emit("viewed", "value");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segments = useMemo(
    () => valueSegments({ name: firstName, target }),
    [firstName, target],
  );

  const toggle = (id: GuidedPath) => {
    setPicks((current) => {
      if (current.includes(id)) {
        emit("deselected", "path", { path: id });
        return current.filter((p) => p !== id);
      }
      emit("selected", "path", { path: id, order: current.length + 1 });
      return [...current, id];
    });
  };

  return (
    <TakeoverRow fading={fading} maxWidth={720}>
      <Box
        minH="84px"
        fontFamily={HEADING_FONT}
        fontSize="30px"
        lineHeight="1.25"
        color="fg"
        data-testid="value-line"
      >
        <Typewriter
          segments={segments}
          speed={26}
          onDone={() => setTyped(true)}
        />
      </Box>
      <Grid
        mt={7}
        templateColumns="repeat(2, minmax(0, 1fr))"
        gap={3}
        transition="all 0.5s ease"
        opacity={typed ? 1 : 0}
        transform={typed ? "translateY(0)" : "translateY(12px)"}
        pointerEvents={typed ? "auto" : "none"}
        aria-hidden={!typed}
        data-testid="value-cards"
      >
        {GUIDED_PATHS.map((id) => {
          const order = picks.indexOf(id);
          const picked = order >= 0;
          return (
            <chakra.button
              key={id}
              type="button"
              aria-pressed={picked}
              aria-label={GUIDED_PATH_TITLES[id]}
              onClick={() => toggle(id)}
              position="relative"
              display="flex"
              alignItems="flex-start"
              gap={3}
              textAlign="left"
              borderRadius="16px"
              border="1px solid"
              borderColor={picked ? "orange.muted" : "border"}
              bg={picked ? "orange.subtle/60" : "bg.panel/85"}
              backdropFilter="blur(4px)"
              px={4}
              py={4}
              pr={10}
              cursor="pointer"
              transition="all 0.15s ease"
              _hover={{
                transform: "translateY(-2px)",
                boxShadow: "0 8px 28px rgba(26, 26, 46, 0.10)",
                borderColor: picked ? "orange.muted" : "fg",
              }}
            >
              <Flex
                position="absolute"
                top="14px"
                right="14px"
                w="20px"
                h="20px"
                align="center"
                justify="center"
                borderRadius="6px"
                border="1px solid"
                borderColor={picked ? "frontDoor.action" : "border.emphasized"}
                bg={picked ? "frontDoor.action" : "bg.panel"}
                color={picked ? "white" : "transparent"}
                fontSize="10.5px"
                fontWeight="600"
                transition="all 0.15s ease"
                data-testid={`pick-order-${id}`}
              >
                {picked ? order + 1 : ""}
              </Flex>
              <Flex
                w="40px"
                h="40px"
                flexShrink={0}
                align="center"
                justify="center"
                overflow="hidden"
                borderRadius="12px"
                bg="bg.muted"
              >
                <chakra.img
                  src={PATH_ICONS[id]}
                  alt=""
                  w="28px"
                  h="28px"
                  objectFit="contain"
                />
              </Flex>
              <Box minW={0}>
                <Text fontSize="14.5px" fontWeight="600" color="fg">
                  {GUIDED_PATH_TITLES[id]}
                </Text>
                <Text
                  mt={0.5}
                  fontSize="12px"
                  lineHeight="1.6"
                  color="fg.muted"
                >
                  {GUIDED_PATH_DESCRIPTIONS[id]}
                </Text>
              </Box>
            </chakra.button>
          );
        })}
      </Grid>
      <NextButton
        show={picks.length > 0}
        onClick={() => {
          emit("clicked", "next", { screen: "value", paths: picks });
          onNext(picks);
        }}
      />
    </TakeoverRow>
  );
}
