/**
 * useSequentialAudioPlayback — per-renderer-instance audio playback coordinator.
 *
 * Responsibilities:
 *  - Exclusivity: when any registered audio starts playing, all others are paused.
 *  - Sequential auto-advance: when an audio ends, the next audio in `orderedIds`
 *    is played. The ordered list is passed each render so appended messages are
 *    always reflected without requiring ref re-fire.
 *  - Isolation: each call to this hook is independent; two renderer instances do
 *    not interfere.
 *
 * Usage (canonical caller: ScenarioMessageRenderer):
 *   const orderedIds = useMemo(
 *     () => items.filter((i) => i.kind === "media" && i.part.type === "audio").map((i) => i.id),
 *     [items],
 *   );
 *   const { getAudioProps } = useSequentialAudioPlayback({ orderedIds });
 *
 *   // Wire into each <MediaPart>:
 *   <MediaPart part={item.part} projectId={projectId} audioPlayback={getAudioProps(item.id)} />
 */

import { useRef, useCallback } from "react";

interface SequentialAudioPlaybackOptions {
  /**
   * Stable-ordered list of audio item ids, updated each render.
   * "Next" is resolved by position in this list, so streaming appends are
   * automatically handled without requiring the <audio> ref to re-fire.
   */
  orderedIds: string[];
}

export interface AudioPlaybackProps {
  ref: (el: HTMLAudioElement | null) => void;
  onPlay: () => void;
  onEnded: () => void;
}

export interface SequentialAudioPlayback {
  /**
   * Returns the ref/event props to spread onto a <MediaPart audioPlayback={...}>.
   * Stable across renders — the closures capture refs, not closed-over values.
   */
  getAudioProps: (id: string) => AudioPlaybackProps;
}

export function useSequentialAudioPlayback({
  orderedIds,
}: SequentialAudioPlaybackOptions): SequentialAudioPlayback {
  // Single source of ordering truth — updated every render via the ref trick,
  // so handleEnded always sees the latest list even after streaming appends.
  const orderedIdsRef = useRef<string[]>(orderedIds);
  orderedIdsRef.current = orderedIds;

  // Map from stable audio id → registered HTMLAudioElement.
  const registryRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const handlePlay = useCallback((id: string) => {
    // Pause every registered audio that isn't the one that just started.
    for (const [entryId, el] of registryRef.current.entries()) {
      if (entryId !== id && !el.paused) {
        el.pause();
      }
    }
  }, []);

  const handleEnded = useCallback((id: string) => {
    const list = orderedIdsRef.current;
    const idx = list.indexOf(id);
    if (idx === -1) return; // id not in list (unmounted) — stop

    const nextId = list[idx + 1];
    if (!nextId) return; // last audio — chain stops

    const nextEl = registryRef.current.get(nextId);
    if (!nextEl) return;

    // Kick off the next audio. Reject gracefully so we don't throw an
    // unhandledrejection (e.g. if the source is unloadable).
    nextEl.play().catch(() => {
      // Chain stops here; no further auto-advance is triggered.
    });
  }, []);

  const getAudioProps = useCallback(
    (id: string): AudioPlaybackProps => ({
      ref: (el: HTMLAudioElement | null) => {
        if (el) {
          registryRef.current.set(id, el);
        } else {
          registryRef.current.delete(id);
        }
      },
      onPlay: () => handlePlay(id),
      onEnded: () => handleEnded(id),
    }),
    [handlePlay, handleEnded],
  );

  return { getAudioProps };
}
