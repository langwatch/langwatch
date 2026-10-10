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
const CARD_WIDTHS = { narrow: "400px", wide: "560px", full: "1200px" } as const;

/** The sign-in doors' card: a near-solid pane, a fine hairline and one soft lift. */
const GLASS = {
  bg: { base: "rgba(255, 255, 255, 0.86)", _dark: "rgba(16, 16, 19, 0.82)" },
  border: { base: "rgba(20, 20, 23, 0.08)", _dark: "rgba(255, 255, 255, 0.09)" },
  shadow: {
    base: "0 1px 2px rgba(20, 20, 23, 0.04), 0 16px 40px -20px rgba(20, 20, 23, 0.18)",
    _dark: "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px -24px rgba(0, 0, 0, 0.65)",
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
        backdropFilter="blur(24px)"
        borderColor={GLASS.border}
        borderWidth={{ base: 0, sm: "1px" }}
        borderRadius={{ base: 0, sm: "14px" }}
        boxShadow={GLASS.shadow}
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
