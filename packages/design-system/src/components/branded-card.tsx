/**
 * The standalone branded card: wordmark, centred title and intro, a body, over the soft
 * brand ground. Presentational only; the sign-in doors and the pages a link lands on share it.
 */
import { Box, Card, Container, Flex, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { AmbientGround } from "./ambient-ground.tsx";
import { FullLogo } from "./full-logo.tsx";

/** Hooks a host stylesheet addresses: `data-*` attributes and nothing else. */
type DataAttributes = Record<`data-${string}`, string | boolean>;

/** The page under a card: the brand ground, with the card centred over it. */
export function BrandedCardPage({ children }: { children: ReactNode }) {
  return (
    <Box position="relative" minHeight="100vh" width="full" overflowX="hidden" bg="bg">
      <Box position="absolute" inset={0} overflow="hidden" pointerEvents="none" zIndex={0}>
        <AmbientGround />
      </Box>
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
      >
        {children}
      </Flex>
    </Box>
  );
}

export function BrandedCard({
  title,
  intro,
  footer,
  className,
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
  /** A host stylesheet's class for the card surface; it then owns the glass. */
  className?: string;
  cardAttributes?: DataAttributes;
  logoAttributes?: DataAttributes;
  bodyAttributes?: DataAttributes;
  children?: ReactNode;
}) {
  return (
    <Container
      maxW={{ base: "100%", sm: "408px" }}
      paddingX={{ base: 0, sm: 2 }}
      marginY={{ base: 6, md: "8vh" }}
    >
      <Card.Root
        className={className}
        width="full"
        {...(className ? {} : { bg: "bg.panel/85", backdropFilter: "blur(18px)" })}
        borderWidth={{ base: 0, sm: "1px" }}
        borderRadius={{ base: 0, sm: "14px" }}
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
            <VStack width="full" align="stretch" gap="14px" {...bodyAttributes}>
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
    </Container>
  );
}
