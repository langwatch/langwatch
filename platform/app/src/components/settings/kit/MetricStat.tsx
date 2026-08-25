import { Box, Card, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * One number, and the sentence that stops it being read wrongly.
 *
 * A band of bare numbers is the most confidently wrong thing a settings page
 * can draw. "Last sync: 4 minutes ago" is true of the freshest source and says
 * nothing about the one that stopped yesterday; "24 members" is a different
 * claim from "24 provisioned members". So `sub` is not a caption — it is the
 * qualifier that makes the headline honest, and it carries its own tone so a
 * band of six can be scanned for the one that is wrong.
 */
export function MetricStat({
  label,
  value,
  sub,
  subTone = "neutral",
  "data-testid": testId,
}: {
  label: ReactNode;
  value: ReactNode;
  /** What the headline leaves out. Almost always worth writing. */
  sub?: ReactNode;
  subTone?: "neutral" | "good" | "bad" | "warning";
  "data-testid"?: string;
}) {
  const subColor =
    subTone === "good"
      ? "green.fg"
      : subTone === "bad"
        ? "red.fg"
        : subTone === "warning"
          ? "orange.fg"
          : "fg.subtle";

  return (
    <Card.Root width="full" data-testid={testId}>
      <Card.Body paddingX={4} paddingY={3}>
        <VStack align="start" gap={0.5}>
          <Text
            fontSize="10.5px"
            fontWeight="600"
            letterSpacing="0.06em"
            textTransform="uppercase"
            color="fg.subtle"
          >
            {label}
          </Text>
          <Text
            fontSize="20px"
            fontWeight="600"
            lineHeight="1.2"
            letterSpacing="-0.01em"
            // Tabular figures so a band of numbers lines up and a value
            // ticking over does not shuffle the ones beside it.
            fontVariantNumeric="tabular-nums"
          >
            {value}
          </Text>
          {sub && (
            <Text fontSize="11.5px" lineHeight="1.5" color={subColor}>
              {sub}
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * A note that explains the page rather than belonging to any one thing on it.
 *
 * Used where a reader would otherwise draw a confident wrong conclusion from
 * what they can see — a filter applied before the data arrived, a column
 * somebody else owns. It is a card so it cannot be mistaken for a row, and it
 * is quiet so it cannot be mistaken for a warning.
 */
export function ExplainerNote({
  icon,
  children,
  "data-testid": testId,
}: {
  icon?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Card.Root width="full" data-testid={testId}>
      <Card.Body paddingX={4} paddingY={3}>
        <HStack align="start" gap={2.5}>
          {icon && (
            <Box color="fg.subtle" flexShrink={0} marginTop="2px">
              {icon}
            </Box>
          )}
          <Text fontSize="12px" lineHeight="1.6" color="fg.muted">
            {children}
          </Text>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Nothing here yet, and what to do about it.
 *
 * Never a blank panel: an empty region and a region that failed to load look
 * identical, and the reader cannot tell which they are looking at. The body
 * says what would be here and the action is the way to make it so.
 */
export function SettingsEmptyState({
  icon,
  title,
  body,
  action,
  "data-testid": testId,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Card.Root width="full" data-testid={testId}>
      <Card.Body paddingX={6} paddingY={10}>
        <VStack gap={2} textAlign="center" maxWidth="52ch" marginX="auto">
          {icon && <Box color="fg.subtle">{icon}</Box>}
          <Text fontSize="13.5px" fontWeight="640" letterSpacing="-0.005em">
            {title}
          </Text>
          {body && (
            <Text fontSize="12.5px" lineHeight="1.6" color="fg.muted">
              {body}
            </Text>
          )}
          {action && <Box paddingTop={2}>{action}</Box>}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
