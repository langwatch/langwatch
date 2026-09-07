import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * The settings design language, in four pieces.
 *
 * Authentication, Directory, Roles and Access were four pages that agreed
 * about nothing: one stacked its labels above its values in small caps,
 * another put them in a table, a third used cards with headings a size apart,
 * and every one of them spaced its sections differently. Read one after
 * another they did not look like one product, and an administrator moving
 * between them had to re-learn where to find the answer each time.
 *
 * So the shape is fixed here and imported, rather than described in a document
 * and re-typed per page:
 *
 *   SectionTitle   what this group of settings is, and why it exists
 *   SettingList    the group, hairline-separated
 *   SettingRow     one setting: name on the left, its state on the right
 *   StatusDot      a state worth seeing before it is read
 *
 * A ROW IS NAME-LEFT, STATE-RIGHT, and that is the whole reason it reads
 * quickly: every value lands on the same vertical line, so an administrator
 * checking six settings scans one column instead of six paragraphs. The
 * stacked small-caps arrangement this replaces put each value in a different
 * place and made a card of five facts into five separate reads.
 *
 * The hint belongs UNDER THE NAME, never beside the value. It explains what
 * the setting is for, and a reader who already knows skips the second line
 * without it ever getting between them and the answer.
 */
export function SettingRow({
  label,
  hint,
  children,
  "data-testid": testId,
}: {
  label: ReactNode;
  /** What this setting is for, in one line. Never how it is built. */
  hint?: ReactNode;
  /** The state, and whatever changes it. Right-aligned. */
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    /*
     * TWO EQUAL COLUMNS, AND THE VALUE STARTS AT THE SAME PLACE EVERY TIME.
     *
     * This was a flex row with the value pushed to the right edge, which
     * sounds tidier and is not: the value's left edge then depended on how
     * long the value was, so a column of six answers started in six different
     * places and could not be scanned at all. Worse, a long value and a long
     * name fought over the same space and the name lost, wrapping one word
     * per line.
     *
     * A half-and-half grid fixes both. The name gets a column that cannot be
     * squeezed, the value gets a column that starts on a fixed line, and a
     * value too long for it wraps inside its own half instead of pushing
     * anything.
     */
    <Box
      display="grid"
      gridTemplateColumns="1fr 1fr"
      alignItems="center"
      gap={6}
      width="full"
      paddingY={2.5}
      data-testid={testId}
    >
      <Box minWidth={0}>
        <Text fontSize="13px" fontWeight="500" lineHeight="1.4">
          {label}
        </Text>
        {hint && (
          <Text
            fontSize="11.5px"
            lineHeight="1.5"
            color="fg.muted"
            marginTop={0.5}
          >
            {hint}
          </Text>
        )}
      </Box>
      {children && (
        <HStack gap={2} minWidth={0} align="center">
          {children}
        </HStack>
      )}
    </Box>
  );
}

/**
 * A group of rows, separated by a hairline so the group reads as one object.
 *
 * The separator is between rows rather than around them: a box drawn around
 * every setting turns a list of six into six competing cards.
 */
export function SettingList({
  children,
  "data-testid": testId,
}: {
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      separator={<Box height="1px" background="border.muted" />}
      data-testid={testId}
    >
      {children}
    </VStack>
  );
}

/**
 * What a group of settings is, above it.
 *
 * The hint is where the group earns its place on the page — "Applies to
 * browser sessions and to every device somebody signs in from" tells a reader
 * whether to keep reading, and a bare heading does not.
 */
export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** A badge or a control belonging to the group as a whole. */
  right?: ReactNode;
}) {
  return (
    <HStack
      width="full"
      align="start"
      gap={3}
      paddingBottom={hint ? 2 : 1}
      as="header"
    >
      <VStack align="start" gap={0.5} minWidth={0} flex={1}>
        <Text
          as="h3"
          fontSize="13px"
          fontWeight="640"
          letterSpacing="-0.005em"
          lineHeight="1.35"
        >
          {title}
        </Text>
        {hint && (
          <Text fontSize="11.5px" lineHeight="1.55" color="fg.muted">
            {hint}
          </Text>
        )}
      </VStack>
      {right && <Box flexShrink={0}>{right}</Box>}
    </HStack>
  );
}

/**
 * A state, before it is read.
 *
 * Deliberately never the ONLY carrier of its meaning — it stands beside a word
 * that says the same thing, because colour is the one channel some readers do
 * not have. It exists so a page of six healthy things and one broken one can
 * be scanned rather than read.
 */
export function StatusDot({
  tone,
  "data-testid": testId,
}: {
  tone: "ok" | "warning" | "bad" | "neutral";
  "data-testid"?: string;
}) {
  const background =
    tone === "ok"
      ? "green.solid"
      : tone === "warning"
        ? "orange.solid"
        : tone === "bad"
          ? "red.solid"
          : "fg.subtle";

  return (
    <Box
      width="6px"
      height="6px"
      borderRadius="full"
      background={background}
      flexShrink={0}
      // The word beside it carries the meaning; this is decoration on top.
      aria-hidden="true"
      data-testid={testId}
    />
  );
}

/**
 * The quiet line under a card that sends somebody somewhere else.
 *
 * These pages are a cluster, and each one repeatedly needs to say "that lives
 * on the next page over". Given its own shape, the pointer is consistently the
 * least loud thing in the card rather than competing with the settings above
 * it.
 */
export function SettingFootnote({ children }: { children: ReactNode }) {
  return (
    <Box
      borderTopWidth="1px"
      borderColor="border.muted"
      marginTop={3}
      paddingTop={2.5}
    >
      <Text fontSize="11.5px" lineHeight="1.6" color="fg.muted">
        {children}
      </Text>
    </Box>
  );
}
