/**
 * One entry of the runs rail: the name of the run, the note the person left
 * with it, how long ago it started and how it went.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { PassRateCircle } from "~/components/shared/PassRateIndicator";

export type RunsSidebarEntryProps = {
  title: string;
  note: string | null;
  timeAgo: string;
  passRate: number | null;
  passedCount: number | null;
  isSelected: boolean;
  isPending?: boolean;
  onClick?: () => void;
  testId: string;
};

/** One line, with the whole note on hover, so a long note never grows the entry. */
function EntryNote({
  note,
  testId,
}: Pick<RunsSidebarEntryProps, "note" | "testId">) {
  if (!note) return null;

  return (
    <Text
      fontSize="11px"
      color="fg.muted"
      truncate
      title={note}
      data-testid={`${testId}-note`}
    >
      {note}
    </Text>
  );
}

/** How the run went: the circle is the one place the outcome reads. */
function EntryResult({
  passRate,
  passedCount,
  testId,
}: Pick<RunsSidebarEntryProps, "passRate" | "passedCount" | "testId">) {
  if (passRate === null && passedCount === null) return null;

  return (
    <HStack gap={1} data-testid={`${testId}-result`}>
      <PassRateCircle passRate={passRate} size="8px" />
      <Text fontSize="11px" fontWeight="medium" color="fg.muted">
        {passRate === null ? "-" : `${Math.round(passRate)}%`}
      </Text>
      {passedCount !== null ? (
        <Text fontSize="11px" color="fg.muted">
          · {passedCount} passed
        </Text>
      ) : null}
    </HStack>
  );
}

/** The name line, which carries no result colour of its own. */
function EntryTitleLine({
  title,
  timeAgo,
  isPending,
  testId,
}: Pick<RunsSidebarEntryProps, "title" | "timeAgo" | "isPending" | "testId">) {
  return (
    <HStack gap={1.5} width="full" data-testid={`${testId}-title`}>
      {isPending ? <Spinner size="xs" /> : null}
      <Text fontSize="xs" fontWeight="semibold" truncate>
        {title}
      </Text>
      <Box flex={1} />
      <Text fontSize="10px" color="fg.muted" whiteSpace="nowrap">
        {timeAgo}
      </Text>
    </HStack>
  );
}

export function RunsSidebarEntry({
  title,
  note,
  timeAgo,
  passRate,
  passedCount,
  isSelected,
  isPending,
  onClick,
  testId,
}: RunsSidebarEntryProps) {
  return (
    <VStack
      as="button"
      align="stretch"
      gap={0.5}
      width="full"
      paddingX={3}
      paddingY={2}
      borderRadius="lg"
      textAlign="left"
      cursor={onClick ? "pointer" : "default"}
      background={isSelected ? "bg.muted" : undefined}
      _hover={onClick ? { background: "bg.muted" } : undefined}
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      data-testid={testId}
      data-selected={isSelected ? "true" : undefined}
    >
      <EntryTitleLine
        title={title}
        timeAgo={timeAgo}
        isPending={isPending}
        testId={testId}
      />
      <EntryNote note={note} testId={testId} />
      <EntryResult
        passRate={passRate}
        passedCount={passedCount}
        testId={testId}
      />
    </VStack>
  );
}
