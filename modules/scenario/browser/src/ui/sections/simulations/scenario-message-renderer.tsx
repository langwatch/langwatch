import { useMemo } from "react";
import type { SimulationMessage } from "@langwatch/scenario-contract";
import {
  ConversationThread,
  type DisplayPart,
  flattenMessages,
} from "@langwatch/trace-browser/surfaces/conversation";

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
  /** A voice run the reader placed themselves, so their turns read as "You". */
  isHumanCaller?: boolean;
}

/**
 * A scenario run's transcript. Flattening and rendering live in the shared
 * conversation renderer; this component's job is swapped roles (`user` is
 * the simulated user, `assistant` the agent) plus media and turn separators.
 */
export function ScenarioMessageRenderer({
  messages,
  streamingMessages,
  variant,
  projectId,
  typingRole,
  isHumanCaller = false,
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
        roleMode={isHumanCaller ? "scenario-human-caller" : "scenario"}
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
 * the next. Ordered ids are filtered to audio so a sibling video can't
 * offset "next"; the accessor answers `undefined` for any non-audio part.
 */
function useConversationAudio(parts: DisplayPart[]) {
  const orderedIds = useMemo(() => parts.filter(isAudioPart).map((part) => part.id), [parts]);

  const { getAudioProps } = useSequentialAudioPlayback({ orderedIds });

  return (part: DisplayPart) => (isAudioPart(part) ? getAudioProps(part.id) : undefined);
}

function isAudioPart(part: DisplayPart): part is Extract<DisplayPart, { kind: "media" }> {
  return part.kind === "media" && part.part.type === "audio";
}
