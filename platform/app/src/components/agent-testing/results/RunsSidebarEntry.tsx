/**
 * One entry of the runs rail: the name of the run, the note the person left
 * with it, how long ago it started and how it went.
 *
 * A run that is still going reads its progress instead of a pass rate it does
 * not have yet. A run against more than one target reads one rate per target
 * once it settled, so the rail already says which did better.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { FG_MUTED } from "../shared/design";
import { PassRateText } from "../shared/PassRateText";
import { passRateColor } from "../shared/pass-rate-color";

/** How one target of a comparison did, and the colour it reads in. */
export type SidebarTargetRate = {
  key: string;
  color: string;
  passRate: number | null;
};

export type RunsSidebarEntryProps = {
  title: string;
  note: string | null;
  timeAgo: string;
  passRate: number | null;
  passedCount: number | null;
  /**
   * One rate per target, on a run against more than one. Such a run reads
   * the rates side by side and no rate of the whole.
   */
  targetRates?: SidebarTargetRate[];
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

/**
 * How a comparison went: one rate per target, "62% vs 81% · 2 targets".
 *
 * The dot before each rate is the colour of the target, which is what tells
 * the two rates apart; the rate itself reads in its own pass-rate colour, the
 * same scale as everywhere else on the surface.
 */
function ComparisonResult({
  targetRates,
  testId,
}: {
  targetRates: SidebarTargetRate[];
  testId: string;
}) {
  return (
    <HStack gap={1} flexWrap="wrap" data-testid={`${testId}-result`}>
      {targetRates.map((target, index) => (
        <HStack key={target.key} gap={1}>
          {index > 0 ? (
            <Text fontSize="10.5px" color={FG_MUTED}>
              vs
            </Text>
          ) : null}
          <Box
            boxSize="6px"
            borderRadius="full"
            flexShrink={0}
            backgroundColor={target.color}
            data-testid={`${testId}-target-dot-${target.key}`}
          />
          <PassRateText passRate={target.passRate} fontSize="10.5px" />
        </HStack>
      ))}
      <Text fontSize="10.5px" color={FG_MUTED}>
        · {targetRates.length} targets
      </Text>
    </HStack>
  );
}

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
  targetRates,
  isRunning,
  judgedCount,
  totalCount,
  testId,
}: Pick<
  RunsSidebarEntryProps,
  | "passRate"
  | "passedCount"
  | "targetRates"
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

  if (targetRates && targetRates.length > 1) {
    return <ComparisonResult targetRates={targetRates} testId={testId} />;
  }

  if (passRate === null && passedCount === null) return null;

  return (
    <HStack gap={1} data-testid={`${testId}-result`}>
      <Box
        boxSize="6px"
        borderRadius="full"
        flexShrink={0}
        backgroundColor={passRateColor(passRate)}
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
  targetRates,
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
        targetRates={targetRates}
        isRunning={isRunning}
        judgedCount={judgedCount}
        totalCount={totalCount}
        testId={testId}
      />
    </VStack>
  );
}
