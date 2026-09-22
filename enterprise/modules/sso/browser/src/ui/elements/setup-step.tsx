// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One step of setting single sign-on up, as a row of one connected list: a
 * timeline rather than five cards of equal weight, closing as it goes so a
 * finished step keeps its answer and loses its workspace. Which step is in
 * which state is `model/setup-progress.ts`'s decision, never this file's.
 */
import { Badge, Box, Card, Collapsible, HStack, Heading, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { SetupStepState } from "../../model/setup-progress.ts";

const CHIP: Record<SetupStepState, { label: string; palette: string } | null> = {
  done: { label: "Done", palette: "green" },
  current: { label: "Do this next", palette: "yellow" },
  blocked: { label: "Waiting", palette: "gray" },
  todo: null,
};

/** The geometry the rail and the markers both hang on, in one place. */
const PADDING_X = 20;
const PADDING_Y = 14;
const MARKER = 22;
const MARKER_GAP = 10;
const RAIL_WIDTH = 2;
const BODY_INDENT = PADDING_X + MARKER + MARKER_GAP;

/** The joined column the steps are rows of. */
export function SetupSteps({ children }: { children: ReactNode }) {
  return (
    <Card.Root borderRadius="xl" overflow="hidden">
      <VStack align="stretch" gap={0}>
        {children}
      </VStack>
    </Card.Root>
  );
}

export function SetupStep({
  number,
  title,
  state = "todo",
  note,
  summary,
  last = false,
  children,
}: {
  number: number;
  title: string;
  state?: SetupStepState;
  /** Why a blocked step is blocked, in the reader's terms. */
  note?: string;
  /** The one line a finished step keeps when it closes. */
  summary?: ReactNode;
  /** The last row draws no rail below its marker. */
  last?: boolean;
  children: ReactNode;
}) {
  const done = state === "done";
  const chip = CHIP[state];
  // Null is "however this step's state says"; a press pins it, so a reader
  // can reopen a finished step and have it stay open.
  const [pinned, setPinned] = useState<boolean | null>(null);
  const open = pinned ?? !done;

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={({ open: next }) => setPinned(next)}
      borderTopWidth={number === 1 ? 0 : "1px"}
      borderColor="border.muted"
      background={state === "current" ? "bg.subtle" : void 0}
      // The rail belongs to the ROW: drawn inside the header it could only be
      // as tall as the header, leaving an open step's body hanging off nothing.
      position="relative"
      data-testid={`setup-step-${number}`}
      data-step-state={state}
    >
      {!last && <Rail done={done} />}
      <Collapsible.Trigger asChild>
        <HStack
          gap={`${MARKER_GAP}px`}
          paddingX={`${PADDING_X}px`}
          paddingY={`${PADDING_Y}px`}
          cursor="pointer"
          alignItems="start"
          _hover={{ background: "bg.muted" }}
          transition="background 0.15s ease"
          width="full"
          textAlign="left"
        >
          <Marker number={number} state={state} />
          <VStack align="start" gap={0.5} flex="1" minWidth={0}>
            <Heading size="sm">{title}</Heading>
            {/* Never while the step is open — the body already says it, at length. */}
            {!open && summary && (
              <Text fontSize="sm" color="fg.muted" truncate maxWidth="full">
                {summary}
              </Text>
            )}
          </VStack>
          {chip && (
            <Badge
              size="sm"
              colorPalette={chip.palette}
              title={note}
              data-testid={done ? "step-done" : `step-${state}`}
            >
              {chip.label}
            </Badge>
          )}
          <Box
            color="fg.muted"
            transform={open ? "rotate(180deg)" : void 0}
            transition="transform 0.15s ease"
            flexShrink={0}
            paddingTop={1}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </Box>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack
          align="stretch"
          gap={3}
          paddingLeft={`${BODY_INDENT}px`}
          paddingRight={`${PADDING_X}px`}
          paddingBottom={`${PADDING_Y + 6}px`}
        >
          {state === "blocked" && note && (
            <Text fontSize="sm" color="fg.muted" data-testid="step-blocked-note">
              {note}
            </Text>
          )}
          {children}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/**
 * The thread between one marker and the next. It runs past the row's own
 * bottom edge to where the next marker begins, because the rows are separated
 * by a divider and stopping at the edge leaves a break at every join.
 */
function Rail({ done }: { done: boolean }) {
  return (
    <Box
      position="absolute"
      left={`${PADDING_X + MARKER / 2 - RAIL_WIDTH / 2}px`}
      top={`${PADDING_Y + MARKER}px`}
      bottom={`-${PADDING_Y}px`}
      width={`${RAIL_WIDTH}px`}
      background={done ? "green.solid" : "border.emphasized"}
      opacity={done ? 0.5 : 1}
      // Above the next row's top border, which would otherwise cut a hairline
      // across the thread at every join.
      zIndex={1}
      aria-hidden="true"
    />
  );
}

/** Finished is green, the step to do now wears the accent, the rest are quiet. */
function markerBackground(state: SetupStepState): string {
  if (state === "done") return "green.solid";

  return state === "current" ? "colorPalette.solid" : "bg.muted";
}

function Marker({ number, state }: { number: number; state: SetupStepState }) {
  const done = state === "done";

  return (
    <Box
      // Set here because nothing above the marker carries a palette, and a
      // bare `colorPalette.*` falls through to the theme's default one.
      colorPalette="orange"
      width={`${MARKER}px`}
      height={`${MARKER}px`}
      borderRadius="full"
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      background={markerBackground(state)}
      borderWidth={done || state === "current" ? 0 : "1px"}
      borderColor="border.emphasized"
      color={done || state === "current" ? "colorPalette.contrast" : "fg.muted"}
      fontSize="xs"
      fontWeight="semibold"
      transition="background 0.15s ease"
      // Above the rail, so the thread runs behind the circle.
      zIndex={2}
      position="relative"
    >
      {done ? "✓" : number}
    </Box>
  );
}
