/**
 * The whole-call audio player in the run drawer, streamed back through
 * `/api/voice/run/:scenarioRunId/audio`. A failed first load (the provider
 * can lag) shows "not ready yet" with Retry, not a player stuck at zero.
 * @see specs/features/agents/voice-phone.feature
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

/** The `langwatch` run metadata this reads, narrowed to what the signal needs.
 *  Read defensively — a run recorded before targets carried a type has none. */
type RunLangwatchMetadata = { targetType?: string } | null | undefined;

/**
 * Whether the run drawer shows the whole-call player: the run targeted a
 * voice agent (`targetType: "voice"`) and carries the ids the route needs —
 * reliable even for a phone run, whose turns may carry no per-turn audio.
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
