import { Box, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { StatusDot } from "./SettingRow";

/**
 * One card of settings, the same shape everywhere in the cluster.
 *
 * A settings card answers one question, and the answer has a state: single
 * sign-on is active or it is not, a directory is syncing or it has stopped.
 * So the state is part of the header rather than something the reader has to
 * find in the body — a dot, the name, and a badge on the right, in that order,
 * on every card on every page in the cluster.
 *
 * The dot and the badge say the same thing on purpose. The dot is what makes a
 * column of cards scannable; the badge is what makes it readable, and what a
 * reader who does not see the colour gets instead.
 */
export function SettingsCard({
  title,
  hint,
  tone,
  leading,
  badge,
  actions,
  children,
  "data-testid": testId,
}: {
  title: ReactNode;
  /**
   * A mark before the name — the protocol's or the vendor's. It says what
   * kind of thing this card is about before the title is read, which is worth
   * more on a page carrying two cards whose titles are both sentences.
   */
  leading?: ReactNode;
  /** What this card is about, in one line under the title. */
  hint?: ReactNode;
  /** Where this card's subject stands. Omitted where it has no state. */
  tone?: "ok" | "warning" | "bad" | "neutral";
  /** The state in words — always beside the dot, never instead of it. */
  badge?: ReactNode;
  /** What the reader can do about it, along the bottom. */
  actions?: ReactNode;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Card.Root width="full" height="full" data-testid={testId}>
      <Card.Body paddingX={4} paddingY={3.5}>
        <VStack align="stretch" gap={2} height="full">
          <VStack align="stretch" gap={0.5}>
            <HStack width="full" gap={2} align="center">
              {tone && <StatusDot tone={tone} />}
              {leading && (
                <Box color="fg.muted" display="flex" flexShrink={0}>
                  {leading}
                </Box>
              )}
              <Text
                as="h2"
                fontSize="13.5px"
                fontWeight="640"
                letterSpacing="-0.005em"
                lineHeight="1.35"
              >
                {title}
              </Text>
              <Spacer />
              {badge}
            </HStack>
            {hint && (
              <Text fontSize="11.5px" lineHeight="1.55" color="fg.muted">
                {hint}
              </Text>
            )}
          </VStack>

          {children}

          {/* Directly under the settings, not pinned to the floor. Two cards
              side by side are rarely the same length, and a Spacer here left
              the shorter one with a button stranded at the bottom of a void
              the reader had to cross. The card still stretches to match its
              neighbour; the empty space now falls below the action, where it
              reads as a card that is simply shorter. */}
          {actions && (
            <HStack gap={2} flexWrap="wrap" paddingTop={2}>
              {actions}
            </HStack>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
