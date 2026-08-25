import { Box, HStack, Skeleton, VStack } from "@chakra-ui/react";

/**
 * A list of settings rows, before its data lands.
 *
 * A SPINNER SAYS "WAIT". A SKELETON SAYS WHAT FOR. Every section on Security
 * and Profile knows its own shape before it knows its own contents — a row per
 * sign-in method, a row per browser, a row per passkey — and drawing a small
 * spinner in the corner threw that away, so the section arrived as a blank
 * band and then jumped to full height a moment later. The reader's eye has to
 * find its place twice.
 *
 * The geometry matches the real row on purpose: a mark, a name over a quieter
 * second line, and a control at the end. Nothing moves when the answer
 * arrives, which is the whole point — the placeholder is the row, drawn
 * before we can fill it in.
 *
 * `rows` should be what the section usually holds rather than the most it
 * could. Too many placeholders for two real rows is the same jump in the
 * other direction.
 */
export function SettingsRowsSkeleton({
  rows = 3,
  showLead = true,
  showTrailing = true,
  "data-testid": testId = "settings-rows-skeleton",
}: {
  /** How many rows this section usually holds. */
  rows?: number;
  /** The mark at the start of the row — an icon, an avatar. */
  showLead?: boolean;
  /** The control at the end of the row. */
  showTrailing?: boolean;
  "data-testid"?: string;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      width="full"
      data-testid={testId}
      // Named for what it is rather than left as decoration: a reader on a
      // screen reader is told the section is loading instead of being handed
      // a silent block of empty boxes.
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading"
    >
      {Array.from({ length: rows }, (_, index) => (
        <HStack key={index} gap={3} width="full" paddingY={1.5}>
          {showLead && (
            <Skeleton
              height="20px"
              width="20px"
              borderRadius="sm"
              flexShrink={0}
            />
          )}
          <VStack align="start" gap={1.5} flex={1} minWidth={0}>
            {/* Uneven widths, because a column of identical bars reads as a
                loading bar rather than as rows of different names. */}
            <Skeleton height="12px" width={index % 2 === 0 ? "38%" : "30%"} />
            <Skeleton height="10px" width={index % 2 === 0 ? "56%" : "64%"} />
          </VStack>
          {showTrailing && (
            <Skeleton
              height="24px"
              width="72px"
              borderRadius="md"
              flexShrink={0}
            />
          )}
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * A single fact, before it lands — for a section whose body is one line
 * rather than a list.
 */
export function SettingsLineSkeleton({
  width = "40%",
  "data-testid": testId = "settings-line-skeleton",
}: {
  width?: string;
  "data-testid"?: string;
}) {
  return (
    <Box
      width="full"
      data-testid={testId}
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton height="12px" width={width} />
    </Box>
  );
}
