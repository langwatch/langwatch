import { useMemo } from "react";
import type { AudioPlaybackProps } from "../simulations/useSequentialAudioPlayback";
import { useSequentialAudioPlayback } from "../simulations/useSequentialAudioPlayback";
import type { DisplayPart } from "./types";

/**
 * Sequential playback for the thread's audio parts: one clip finishing starts
 * the next.
 *
 * The ordered ids are filtered to audio so a sibling video or attachment
 * cannot offset the hook's idea of "next".
 */
export function useThreadAudioPlayback(parts: DisplayPart[]): {
  audioPropsFor: (part: DisplayPart) => AudioPlaybackProps | undefined;
} {
  const orderedIds = useMemo(
    () =>
      parts
        .filter(
          (part): part is Extract<DisplayPart, { kind: "media" }> =>
            part.kind === "media" && part.part.type === "audio",
        )
        .map((part) => part.id),
    [parts],
  );

  const { getAudioProps } = useSequentialAudioPlayback({ orderedIds });

  return {
    audioPropsFor: (part) =>
      part.kind === "media" && part.part.type === "audio"
        ? getAudioProps(part.id)
        : undefined,
  };
}
