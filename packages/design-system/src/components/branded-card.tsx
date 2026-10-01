/**
 * The standalone branded page: one brand ground held to the viewport, one glass card on it.
 * Every page a link or a command line lands on uses these two, with no page-level overrides.
 */
import { Box, Card, Flex, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { AmbientGround } from "./ambient-ground.tsx";
import { FullLogo } from "./full-logo.tsx";

/** Hooks a host stylesheet addresses: `data-*` attributes and nothing else. */
type DataAttributes = Record<`data-${string}`, string | boolean>;

/** How wide the card stands from `sm` up: a message or form, a list-heavy step, a wide step. */
const CARD_WIDTHS = { narrow: "408px", wide: "560px", full: "1200px" } as const;

/** The sign-in doors' glass: a translucent pane, a soft hairline and one lift. */
const GLASS = {
  bg: { base: "rgba(255, 255, 255, 0.3)", _dark: "rgba(10, 10, 12, 0.54)" },
  border: { base: "rgba(20, 20, 23, 0.09)", _dark: "rgba(255, 255, 255, 0.1)" },
  shadow: {
    base: "inset 0 1px 1px rgba(255, 255, 255, 0.9), inset 0 0 0 0.5px rgba(255, 255, 255, 0.5), 0 24px 48px -20px rgba(20, 20, 23, 0.28)",
    _dark: "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 24px 60px -24px rgba(0, 0, 0, 0.65)",
  },
  /** While anything on the card holds focus, the glass warms with the brand's light. */
  focusShadow: {
    base: "inset 0 1px 1px rgba(255, 255, 255, 0.9), inset 0 0 0 0.5px rgba(255, 255, 255, 0.5), 0 24px 48px -20px rgba(20, 20, 23, 0.28), 0 0 56px -14px rgba(245, 107, 26, 0.28)",
    _dark:
      "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 24px 60px -24px rgba(0, 0, 0, 0.65), 0 0 56px -14px rgba(255, 138, 61, 0.22)",
  },
} as const;

/**
 * The ground sticks to the viewport, so it never slides or stretches, and stays inside the
 * page's own box. A short card centres; a tall one starts 48px down and the page scrolls.
 */
export function BrandedCardPage({
  ground,
  children,
}: {
  /** A ground that moves with its page (the sign-in doors'); the ambient ground otherwise. */
  ground?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box position="relative" isolation="isolate" minHeight="100dvh" width="full">
      <Box
        position="sticky"
        top={0}
        zIndex={-1}
        height="100dvh"
        marginBottom="-100dvh"
        overflow="hidden"
        pointerEvents="none"
        bg="bg"
        aria-hidden="true"
      >
        {ground ?? <AmbientGround />}
      </Box>
      <Flex
        direction="column"
        align="center"
        minHeight="100dvh"
        width="full"
        paddingX={{ base: 0, sm: 4 }}
        paddingY={{ base: 0, sm: 12 }}
      >
        {children}
      </Flex>
    </Box>
  );
}

/**
 * Logo, centred title and intro, then the body. A paragraph set straight in the body is
 * centred with the heading; fields and controls keep their own alignment.
 */
export function BrandedCard({
  title,
  intro,
  footer,
  size = "narrow",
  cardAttributes,
  logoAttributes,
  bodyAttributes,
  children,
}: {
  title: string;
  /** One quiet line answering the heading, centred with it. */
  intro?: string;
  /** Small print under the body. */
  footer?: ReactNode;
  size?: keyof typeof CARD_WIDTHS;
  cardAttributes?: DataAttributes;
  logoAttributes?: DataAttributes;
  bodyAttributes?: DataAttributes;
  children?: ReactNode;
}) {
  return (
    <Flex
      direction="column"
      width="full"
      maxWidth={{ base: "100%", sm: CARD_WIDTHS[size] }}
      flex={{ base: "1", sm: "none" }}
      marginY={{ base: 0, sm: "auto" }}
    >
      <Card.Root
        flex="1"
        width="full"
        bg={GLASS.bg}
        backdropFilter="blur(26px) saturate(1.35)"
        borderColor={GLASS.border}
        borderWidth={{ base: 0, sm: "1px" }}
        borderRadius={{ base: 0, sm: "14px" }}
        boxShadow={GLASS.shadow}
        transition="box-shadow 420ms ease"
        _focusWithin={{ boxShadow: GLASS.focusShadow }}
        _motionReduce={{ transition: "none" }}
        {...cardAttributes}
      >
        <Card.Header paddingTop="34px" paddingX="32px" paddingBottom={0}>
          <VStack gap="12px">
            <Box display="flex" justifyContent="center" {...logoAttributes}>
              <FullLogo width={112} height={27.5} />
            </Box>
            <Heading
              as="h1"
              fontSize="19px"
              fontWeight={600}
              letterSpacing="-0.015em"
              textAlign="center"
              css={{ textWrap: "balance" }}
            >
              {title}
            </Heading>
            {intro ? (
              <Text
                fontSize="13.5px"
                lineHeight="1.55"
                color="fg.muted"
                textAlign="center"
                maxWidth="36ch"
                marginTop="-4px"
                css={{ textWrap: "balance" }}
              >
                {intro}
              </Text>
            ) : null}
          </VStack>
        </Card.Header>
        <Card.Body paddingX="32px" paddingTop={children ? "22px" : "16px"} paddingBottom="32px">
          {children ? (
            <VStack
              width="full"
              align="stretch"
              gap="14px"
              css={{ "& > p": { textAlign: "center", textWrap: "pretty" } }}
              {...bodyAttributes}
            >
              {children}
            </VStack>
          ) : null}
          {footer ? (
            <Box paddingTop="18px" textAlign="center">
              {footer}
            </Box>
          ) : null}
        </Card.Body>
      </Card.Root>
    </Flex>
  );
}
