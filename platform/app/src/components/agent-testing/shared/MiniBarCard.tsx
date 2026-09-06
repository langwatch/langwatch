/**
 * One small chart: a title, and groups of bars with the value above each bar
 * and a label under each group.
 *
 * A comparison draws one bar per target in the colour of that target, so the
 * card carries no scale of its own: the value above the bar is the number,
 * and the bar is the glance. A bar with no value is drawn as a gap rather
 * than as a bar of zero, because a zero-height bar reads as a target that
 * scored nothing.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { FG_MUTED } from "./design";

export type MiniBar = {
  key: string;
  color: string;
  /** What the bar stands for, or null when there is nothing to draw. */
  value: number | null;
  /** The number as it reads above the bar. */
  text: string;
};

export type MiniBarGroup = {
  key: string;
  /** What reads under the group. */
  label: string;
  /** The long form of the label, read on hover. The label when not given. */
  title?: string;
  bars: MiniBar[];
};

const BAR_AREA_HEIGHT = 56;
const BAR_MAX_HEIGHT = 34;
const EMPTY_BAR_HEIGHT = 3;

/** The tallest value across every bar of the card, so the bars share a scale. */
function tallestValue(groups: MiniBarGroup[]): number {
  let tallest = 0;
  for (const group of groups) {
    for (const bar of group.bars) {
      if (bar.value !== null && bar.value > tallest) tallest = bar.value;
    }
  }
  return tallest;
}

function barHeight({
  value,
  scale,
}: {
  value: number | null;
  scale: number;
}): number {
  if (value === null || scale <= 0) return EMPTY_BAR_HEIGHT;
  return Math.max((value / scale) * BAR_MAX_HEIGHT, EMPTY_BAR_HEIGHT);
}

/** One bar, with its value above it. */
function BarColumn({ bar, scale }: { bar: MiniBar; scale: number }) {
  return (
    <VStack
      flex={1}
      minWidth={0}
      maxWidth="28px"
      gap={1}
      align="center"
      justify="flex-end"
    >
      <Text
        fontSize="10px"
        fontWeight="medium"
        fontVariantNumeric="tabular-nums"
        whiteSpace="nowrap"
        color={bar.value === null ? FG_MUTED : "fg"}
      >
        {bar.text}
      </Text>
      <Box
        width="full"
        borderTopRadius="sm"
        height={`${barHeight({ value: bar.value, scale })}px`}
        background={bar.value === null ? "border" : bar.color}
        data-testid="mini-bar"
        data-bar-key={bar.key}
      />
    </VStack>
  );
}

/** The bars themselves: one column per bar, the groups side by side. */
function BarArea({
  groups,
  scale,
  testId,
}: {
  groups: MiniBarGroup[];
  scale: number;
  testId?: string;
}) {
  return (
    <HStack
      gap={3}
      height={`${BAR_AREA_HEIGHT}px`}
      alignItems="flex-end"
      marginTop={2}
    >
      {groups.map((group) => (
        <HStack
          key={group.key}
          flex={1}
          minWidth={0}
          gap={1}
          alignItems="flex-end"
          justify="center"
          data-testid={testId ? `${testId}-group-${group.key}` : undefined}
        >
          {group.bars.map((bar) => (
            <BarColumn key={bar.key} bar={bar} scale={scale} />
          ))}
        </HStack>
      ))}
    </HStack>
  );
}

/** The line under the bars: what each group stands for, one label per group. */
function GroupLabels({ groups }: { groups: MiniBarGroup[] }) {
  return (
    <HStack gap={3} marginTop={1}>
      {groups.map((group) => (
        <Text
          key={group.key}
          flex={1}
          minWidth={0}
          fontSize="10px"
          color={FG_MUTED}
          textAlign="center"
          truncate
          title={group.title ?? group.label}
        >
          {group.label}
        </Text>
      ))}
    </HStack>
  );
}

export function MiniBarCard({
  title,
  groups,
  scale,
  testId,
}: {
  title: string;
  groups: MiniBarGroup[];
  /** The value a full-height bar stands for. The tallest bar when absent. */
  scale?: number;
  testId?: string;
}) {
  const fullScale = scale ?? tallestValue(groups);

  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      paddingX={3.5}
      paddingY={3}
      minWidth={0}
      data-testid={testId}
    >
      <Text fontSize="11px" fontWeight="semibold" color={FG_MUTED}>
        {title}
      </Text>
      <BarArea groups={groups} scale={fullScale} testId={testId} />
      <GroupLabels groups={groups} />
    </VStack>
  );
}
