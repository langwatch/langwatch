/**
 * The whole-call audio player in the run drawer.
 *
 * A headless voice run — phone or ElevenLabs — records the whole call, streamed
 * back through `/api/voice/run/:scenarioRunId/audio` (which resolves the vendor
 * handle from the run's own trace spans). Shown only for a voice run, because
 * only a voice run has a call to play.
 *
 * The recording lands with the provider shortly after the call ends, so the
 * first load can fail: rather than a player parked at zero seconds, the failed
 * element is replaced by a stated "not ready yet" line with a Retry that
 * re-requests the recording.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

/** The `langwatch` run metadata this reads, narrowed to what the signal needs.
 *  Read defensively — a run recorded before targets carried a type has none. */
type RunLangwatchMetadata = { targetType?: string } | null | undefined;

/**
 * Whether the run drawer shows the whole-call player: the run targeted a voice
 * agent (both phone and ElevenLabs stamp `targetType: "voice"`), and it carries
 * the ids the route needs. This is the one reliable signal that works for a
 * phone run too, whose turns may carry no per-turn audio of their own.
 */
export function shouldShowWholeCallAudio({
  langwatch,
  scenarioRunId,
  projectId,
}: {
  langwatch: RunLangwatchMetadata;
  scenarioRunId: string | undefined;
  projectId: string | undefined;
}): boolean {
  return langwatch?.targetType === "voice" && !!scenarioRunId && !!projectId;
}

export function WholeCallAudio({
  scenarioRunId,
  projectId,
}: {
  scenarioRunId: string;
  projectId: string;
}) {
  // Bumped on Retry so the <audio> src changes and the browser re-requests the
  // recording rather than replaying its cached failure.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  const src = `/api/voice/run/${encodeURIComponent(
    scenarioRunId,
  )}/audio?projectId=${encodeURIComponent(projectId)}&attempt=${attempt}`;

  if (failed) {
    return (
      <HStack data-testid="run-call-audio-unavailable" gap={2} color="fg.muted">
        <Text fontSize="xs">Recording not ready yet</Text>
        <Button
          size="xs"
          variant="outline"
          data-testid="run-call-audio-retry"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </Button>
      </HStack>
    );
  }

  return (
    <VStack align="flex-start" width="100%" gap={1}>
      <Text fontSize="xs" color="fg.muted">
        Whole call
      </Text>
      <audio
        data-testid="run-call-audio"
        controls
        preload="none"
        src={src}
        onError={() => setFailed(true)}
        style={{ width: "100%", maxWidth: "400px" }}
      />
    </VStack>
  );
}
