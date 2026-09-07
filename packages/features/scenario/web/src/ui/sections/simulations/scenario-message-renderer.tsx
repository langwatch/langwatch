import { useMemo } from "react";
import type { SimulationMessage } from "@langwatch/scenario-contract";
import {
  ConversationThread,
  type DisplayPart,
  flattenMessages,
} from "@langwatch/trace-web/surfaces/conversation";

import type { StreamingMessage } from "../../../behavior/use-simulation-streaming-state.ts";
import { useSequentialAudioPlayback } from "../../../behavior/use-sequential-audio-playback.ts";
import type { NextSpeaker } from "../../elements/next-speaker.ts";
import { TypingBubble } from "../../elements/typing-bubble.tsx";
import { MediaPart } from "../media-part.tsx";
import { RunTurnSeparator } from "./run-turn-separator.tsx";

export interface ScenarioMessageRendererProps {
  messages: SimulationMessage[];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
  /** Project that owns the stored objects in this message thread. */
  projectId: string;
  /** Whose message the run is waiting for, drawn as dots under the thread. */
  typingRole?: NextSpeaker;
}

/**
 * A scenario run's transcript.
 *
 * The flattening and the rendering both live in the shared conversation
 * renderer now — this component's remaining job is to say which of them a
 * scenario is: roles are swapped (the `user` turns come from a simulated user,
 * the `assistant` turns from the agent under test), a grid cell is a preview
 * rather than a transcript, and the media, turn separators and audio playback
 * are the ones this surface owns.
 */
export function ScenarioMessageRenderer({
  messages,
  streamingMessages,
  variant,
  projectId,
  typingRole,
}: ScenarioMessageRendererProps) {
  const parts = useMemo(
    () => flattenMessages({ messages, streaming: streamingMessages }),
    [messages, streamingMessages],
  );

  const audioPlaybackFor = useConversationAudio(parts);

  return (
    <>
      <ConversationThread
        parts={parts}
        variant={variant === "grid" ? "compact" : "regular"}
        roleMode="scenario"
        projectId={projectId}
        audioPlaybackFor={audioPlaybackFor}
        renderMediaPart={({ part, projectId: owner, audioPlayback }) => (
          <MediaPart part={part} projectId={owner} audioPlayback={audioPlayback} />
        )}
        renderTurnSeparator={({ index, traceId }) =>
          traceId ? <RunTurnSeparator index={index} traceId={traceId} /> : null
        }
      />
      {typingRole ? (
        <TypingBubble role={typingRole} size={variant === "grid" ? "compact" : "regular"} />
      ) : null}
    </>
  );
}

/**
 * Sequential audio playback for a thread's parts: one clip finishing starts
 * the next. The ordered ids are filtered to audio so a sibling video or
 * attachment cannot offset the hook's idea of "next", and the returned
 * accessor answers `undefined` for any part that is not audio, so the thread
 * hands it every part without re-testing the kind.
 */
function useConversationAudio(parts: DisplayPart[]) {
  const orderedIds = useMemo(() => parts.filter(isAudioPart).map((part) => part.id), [parts]);

  const { getAudioProps } = useSequentialAudioPlayback({ orderedIds });

  return (part: DisplayPart) => (isAudioPart(part) ? getAudioProps(part.id) : undefined);
}

function isAudioPart(part: DisplayPart): part is Extract<DisplayPart, { kind: "media" }> {
  return part.kind === "media" && part.part.type === "audio";
}
