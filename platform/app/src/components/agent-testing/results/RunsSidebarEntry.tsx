/**
 * One entry of the runs rail: the name of the run, the note the person left
 * with it, how long ago it started and how it went.
 *
 * A run that is still going reads its progress instead of a pass rate it does
 * not have yet.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { FG_MUTED } from "../shared/design";
import { PassRateText } from "../shared/PassRateText";
import { passRateColor } from "../shared/pass-rate-color";

export type RunsSidebarEntryProps = {
  title: string;
  note: string | null;
  timeAgo: string;
  passRate: number | null;
  passedCount: number | null;
  isSelected: boolean;
  isPending?: boolean;
  /** True while the run still has cases to judge. */
  isRunning?: boolean;
  /** How far a running run has got, for its "3/8 judged" line. */
  judgedCount?: number | null;
  totalCount?: number | null;
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
      fontSize="10.5px"
      color={FG_MUTED}
      truncate
      title={note}
      data-testid={`${testId}-note`}
    >
      {note}
    </Text>
  );
}

/**
 * How the run went: the dot and the percentage beside it.
 *
 * Both take their colour from {@link passRateColor}, the one scale the whole
 * surface reads, so a rate here cannot read green while the same rate reads
 * amber in the plan table.
 */
function EntryResult({
  passRate,
  passedCount,
  isRunning,
  judgedCount,
  totalCount,
  testId,
}: Pick<
  RunsSidebarEntryProps,
  | "passRate"
  | "passedCount"
  | "isRunning"
  | "judgedCount"
  | "totalCount"
  | "testId"
>) {
  if (isRunning && typeof totalCount === "number") {
    return (
      <Text fontSize="10.5px" color={FG_MUTED} data-testid={`${testId}-result`}>
        {judgedCount ?? 0}/{totalCount} judged
      </Text>
    );
  }

  if (passRate === null && passedCount === null) return null;

  return (
    <HStack gap={1} data-testid={`${testId}-result`}>
      <Box
        boxSize="6px"
        borderRadius="full"
        flexShrink={0}
        background={passRateColor(passRate)}
        data-testid={`${testId}-result-dot`}
      />
      <PassRateText passRate={passRate} fontSize="10.5px" />
      {passedCount !== null ? (
        <Text fontSize="10.5px" color={FG_MUTED}>
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
  isRunning,
  testId,
}: Pick<
  RunsSidebarEntryProps,
  "title" | "timeAgo" | "isPending" | "isRunning" | "testId"
>) {
  return (
    <HStack gap={1.5} width="full" data-testid={`${testId}-title`}>
      {isPending || isRunning ? <Spinner size="xs" boxSize="11px" /> : null}
      <Text fontSize="12px" fontWeight="semibold" truncate>
        {title}
      </Text>
      <Box flex={1} />
      <Text fontSize="10px" color={FG_MUTED} whiteSpace="nowrap">
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
  isRunning,
  judgedCount,
  totalCount,
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
      _hover={onClick ? { background: "bg.muted/60" } : undefined}
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      data-testid={testId}
      data-selected={isSelected ? "true" : undefined}
    >
      <EntryTitleLine
        title={title}
        timeAgo={timeAgo}
        isPending={isPending}
        isRunning={isRunning}
        testId={testId}
      />
      <EntryNote note={note} testId={testId} />
      <EntryResult
        passRate={passRate}
        passedCount={passedCount}
        isRunning={isRunning}
        judgedCount={judgedCount}
        totalCount={totalCount}
        testId={testId}
      />
    </VStack>
  );
}
