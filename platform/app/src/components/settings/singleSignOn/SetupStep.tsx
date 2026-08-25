import {
  Box,
  Card,
  Collapsible,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { SetupStepState } from "~/features/sso/logic/setupProgress";
import { IdentityChip } from "../../access/IdentityRow";

/**
 * One step of setting single sign-on up, as a row of one connected list.
 *
 * A TIMELINE, NOT FIVE CARDS. The steps are a sequence with a single moving
 * position in it, and five separate cards of equal weight said the opposite:
 * everything is equally your problem right now. Joined into one column with a
 * rail running through the markers, the shape itself carries the order, and
 * the eye lands on the one marker that is not yet green.
 *
 * IT COLLAPSES AS IT GOES. A finished step is an answer, not a workspace —
 * once a domain is proved, the several hundred words explaining how to prove
 * one are pure obstruction between the reader and the step they are actually
 * on. Done steps therefore close and keep only their one-line answer; the
 * current step is open; and anybody can reopen a closed one, because "I
 * finished that, what did I put in it" is a real question and a step that
 * refuses to reopen is a worse answer than one that never closed.
 *
 * FOUR STATES, NOT TWO. A tick and the absence of a tick answer "is this
 * finished" and nothing else, which leaves the reader of a half-built journey
 * with no idea which step is theirs to act on — or why the one they are
 * trying to act on will not complete:
 *
 *   done      finished, and it stays finished
 *   current   THIS is the one to do now
 *   blocked   it cannot be done yet, and the note says what it waits for
 *   todo      later, and unremarkable
 *
 * `blocked` always carries its reason. A step that refuses to say why it is
 * waiting is what makes a journey feel stuck rather than merely unfinished.
 *
 * Which step is in which state is `setupProgress.ts`'s decision, not this
 * component's.
 */

const CHIP: Record<
  SetupStepState,
  { label: string; tone: "good" | "warning" | "neutral" } | null
> = {
  done: { label: "Done", tone: "good" },
  current: { label: "Do this next", tone: "warning" },
  blocked: { label: "Waiting", tone: "neutral" },
  todo: null,
};

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
  /** The one line a finished step keeps when it closes — the answer it
   *  arrived at, so closing loses the workspace and not the fact. */
  summary?: ReactNode;
  /** The last row draws no rail below its marker. */
  last?: boolean;
  children: ReactNode;
}) {
  const done = state === "done";
  const chip = CHIP[state];
  // Null means "however this step's state says". A press pins it, so a
  // reader can reopen a finished step and it stays open.
  const [pinned, setPinned] = useState<boolean | null>(null);
  const open = pinned ?? !done;

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={({ open: next }) => setPinned(next)}
      borderTopWidth={number === 1 ? 0 : "1px"}
      borderColor="border.muted"
      background={state === "current" ? "bg.subtle" : undefined}
      // The rail is the ROW's, not the header's. Drawn inside the header it
      // could only ever be as tall as the header, so an open step's thread
      // stopped a few pixels below its own marker and left the body hanging
      // off nothing.
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
          width="full"
          textAlign="left"
        >
          <Marker number={number} state={state} />
          <VStack align="start" gap={0.5} flex="1" minWidth={0}>
            <Heading size="sm">{title}</Heading>
            {/* The answer a closed step keeps. Never rendered while the step
                is open — the body already says it, at length. */}
            {!open && summary && (
              <Text fontSize="sm" color="fg.muted" truncate maxWidth="full">
                {summary}
              </Text>
            )}
          </VStack>
          {chip && (
            <IdentityChip
              label={chip.label}
              tone={chip.tone}
              title={note}
              data-testid={done ? "step-done" : `step-${state}`}
            />
          )}
          <Box
            color="fg.muted"
            transform={open ? "rotate(180deg)" : undefined}
            transition="transform 0.15s ease"
            flexShrink={0}
            paddingTop={1}
          >
            <ChevronDown size={16} aria-hidden />
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
            <Text
              fontSize="sm"
              color="fg.muted"
              data-testid="step-blocked-note"
            >
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
 * Where the marker sits, in one place.
 *
 * The rail is positioned against the ROW while the marker is laid out by the
 * header's flex row, so the two agree only because these numbers say so: the
 * header's horizontal padding puts the marker's left edge at `PADDING_X`, and
 * its vertical padding puts the top edge at `PADDING_Y`.
 */
const PADDING_X = 20;
const PADDING_Y = 14;
const MARKER = 22;
const MARKER_GAP = 10;
const RAIL_WIDTH = 2;
/** Where a row's body begins: past the marker and the gap after it, so the
 *  content hangs off its own marker rather than starting a new column. */
const BODY_INDENT = PADDING_X + MARKER + MARKER_GAP;

/**
 * The thread between one marker and the next.
 *
 * It starts under this row's marker and runs past the row's own bottom edge,
 * far enough to reach where the next row's marker begins — the rows are
 * separated by a divider and the next marker sits `PADDING_Y` below it, so
 * stopping at `bottom: 0` leaves a visible break at every join.
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
      // Above the NEXT row's top border, which is painted by a later sibling
      // and would otherwise cut a hairline gap across the thread at every
      // join — the exact break this rail exists to close.
      zIndex={1}
      aria-hidden
    />
  );
}

/** The numbered marker. */
function Marker({ number, state }: { number: number; state: SetupStepState }) {
  const done = state === "done";
  return (
    <Box
      width={`${MARKER}px`}
      height={`${MARKER}px`}
      borderRadius="full"
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      background={
        done
          ? "green.solid"
          : state === "current"
            ? "colorPalette.solid"
            : "bg.muted"
      }
      borderWidth={done || state === "current" ? 0 : "1px"}
      borderColor="border.emphasized"
      color={
        done
          ? "white"
          : state === "current"
            ? "colorPalette.contrast"
            : "fg.muted"
      }
      fontSize="11px"
      fontWeight="semibold"
      // Above the rail, so the thread runs behind the circle rather than
      // into its edge.
      zIndex={2}
      position="relative"
    >
      {done ? "✓" : number}
    </Box>
  );
}
