/**
 * useSequentialAudioPlayback — per-renderer-instance audio playback coordinator.
 */

import type { MediaAudioElement, MediaAudioPlayback } from "@langwatch/scenario-contract";
import { useCallback, useRef } from "react";

interface SequentialAudioPlaybackOptions {
  /**
   * Stable-ordered list of audio item ids, updated each render.
   * "Next" is resolved by position in this list, so streaming appends are
   * automatically handled without requiring the <audio> ref to re-fire.
   */
  orderedIds: string[];
}

export interface SequentialAudioPlayback {
  /**
   * Returns the ref/event props to spread onto a <MediaPart audioPlayback={...}>.
   * Stable across renders — the closures capture refs, not closed-over values.
   */
  getAudioProps: (id: string) => MediaAudioPlayback;
}

function pauseOtherAudio(registry: Map<string, MediaAudioElement>, playingId: string): void {
  for (const [entryId, element] of registry.entries()) {
    if (entryId !== playingId && !element.paused) element.pause();
  }
}

export function useSequentialAudioPlayback({
  orderedIds,
}: SequentialAudioPlaybackOptions): SequentialAudioPlayback {
  // Single source of ordering truth — updated every render via the ref trick,
  // so handleEnded always sees the latest list even after streaming appends.
  const orderedIdsRef = useRef<string[]>(orderedIds);
  orderedIdsRef.current = orderedIds;

  // Map from stable audio id → registered audio element.
  const registryRef = useRef<Map<string, MediaAudioElement>>(new Map());

  const handlePlay = useCallback((id: string) => {
    pauseOtherAudio(registryRef.current, id);
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
    (id: string): MediaAudioPlayback => ({
      ref: (el: MediaAudioElement | null) => {
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
