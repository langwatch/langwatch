import { Box, Button, HStack, Link, Progress, Text, VStack } from "@chakra-ui/react";
import { isRedCountdown, remainingSeconds } from "@langwatch/scenario-contract";

import {
  CUT_AT_LIMIT_MESSAGE,
  FETCH_FAILED_NOTICE,
  formatMmSs,
  type TalkState,
} from "../../model/talk-to-it-machine.ts";
import type { VoiceTurn } from "../../model/voice-call.ts";

/** The turn-by-turn transcript, shared by the live and done views. */
function Transcript({ turns }: { turns: VoiceTurn[] }) {
  return (
    <>
      {turns.map((turn, index) => (
        <Text key={index} fontSize="sm">
          <Text as="span" fontWeight="bold">
            {turn.role === "agent" ? "Agent" : "You"}:
          </Text>{" "}
          {turn.text}
        </Text>
      ))}
    </>
  );
}

export function LiveView({
  state,
  micLevel,
  onHangUp,
  maxSeconds,
}: {
  state: Extract<TalkState, { kind: "live" }>;
  micLevel: number;
  onHangUp: () => void;
  maxSeconds: number;
}) {
  const remaining = remainingSeconds({ elapsedMs: state.elapsedMs, maxCallSeconds: maxSeconds });
  const red = isRedCountdown(remaining);
  return (
    <VStack align="stretch" gap={3} data-testid="talk-live">
      <HStack justify="space-between">
        <Text fontWeight="bold" color={red ? "fg.error" : undefined} data-testid="talk-timer">
          {formatMmSs(remaining)}
        </Text>
        <Button size="sm" colorPalette="red" onClick={onHangUp} data-testid="talk-hang-up">
          Hang up
        </Button>
      </HStack>
      <Progress.Root value={Math.round(micLevel * 100)} size="xs">
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      <VStack align="stretch" gap={1} data-testid="talk-transcript">
        <Transcript turns={state.transcript} />
      </VStack>
    </VStack>
  );
}

export function DoneView({
  state,
  runHref,
}: {
  state: Extract<TalkState, { kind: "done" }>;
  runHref?: string;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="talk-done">
      {state.isCutAtLimit && (
        <Text color="fg.muted" data-testid="talk-cut-marker">
          {CUT_AT_LIMIT_MESSAGE}
        </Text>
      )}
      {state.hasFetchFailed && (
        <Text color="fg.muted" data-testid="talk-fetch-failed">
          {FETCH_FAILED_NOTICE}
        </Text>
      )}
      <VStack align="stretch" gap={1}>
        <Transcript turns={state.transcript} />
      </VStack>
      {state.audioUrl && (
        <Box data-testid="talk-play">
          <audio controls preload="none" src={state.audioUrl}>
            <track kind="captions" />
          </audio>
        </Box>
      )}
      {runHref && (
        <Link href={runHref} color="blue.fg" data-testid="talk-run-link">
          Open the run
        </Link>
      )}
    </VStack>
  );
}
