/**
 * useSequentialAudioPlayback — per-renderer-instance audio playback coordinator.
 *
 * Responsibilities:
 *  - Exclusivity: when any registered audio starts playing, all others are paused.
 *  - Sequential auto-advance: when an audio ends, the next audio in registration
 *    order is played. "Next" is resolved by `orderIndex` at the time the `ended`
 *    event fires so that mid-list starts advance from that position onward.
 *  - Isolation: each call to this hook is independent (no module-level or global
 *    state); two renderer instances that each call this hook do not interfere.
 *
 * Usage (inside ScenarioMessageRenderer):
 *   const { registerAudio, unregisterAudio, handlePlay, handleEnded } =
 *     useSequentialAudioPlayback();
 *
 *   // Wire into each <MediaPart>:
 *   <MediaPart
 *     ...
 *     audioId={item.id}
 *     onAudioPlay={() => handlePlay(item.id)}
 *     onAudioEnded={() => handleEnded(item.id)}
 *     onAudioRef={(el) => {
 *       if (el) registerAudio(item.id, el, index);
 *       else unregisterAudio(item.id);
 *     }}
 *   />
 */

import { useRef, useCallback } from "react";

interface AudioEntry {
  element: HTMLAudioElement;
  orderIndex: number;
}

interface SequentialAudioPlayback {
  /** Called by MediaPart's ref callback when an <audio> element mounts or unmounts. */
  registerAudio: (params: {
    id: string;
    element: HTMLAudioElement;
    orderIndex: number;
  }) => void;
  unregisterAudio: (params: { id: string }) => void;
  /** Called when any audio fires its `onPlay` event (including programmatic play). */
  handlePlay: (params: { id: string }) => void;
  /** Called when any audio fires its `onEnded` event. */
  handleEnded: (params: { id: string }) => void;
}

export function useSequentialAudioPlayback(): SequentialAudioPlayback {
  // Map from stable audio id → { element, orderIndex }
  const registryRef = useRef<Map<string, AudioEntry>>(new Map());

  const registerAudio = useCallback(
    ({
      id,
      element,
      orderIndex,
    }: {
      id: string;
      element: HTMLAudioElement;
      orderIndex: number;
    }) => {
      registryRef.current.set(id, { element, orderIndex });
    },
    [],
  );

  const unregisterAudio = useCallback(({ id }: { id: string }) => {
    registryRef.current.delete(id);
  }, []);

  const handlePlay = useCallback(({ id }: { id: string }) => {
    // Pause every registered audio that isn't the one that just started.
    for (const [entryId, entry] of registryRef.current.entries()) {
      if (entryId !== id && !entry.element.paused) {
        entry.element.pause();
      }
    }
  }, []);

  const handleEnded = useCallback(({ id }: { id: string }) => {
    const current = registryRef.current.get(id);
    if (!current) return;

    // Find the entry with the smallest orderIndex that is strictly greater
    // than the current one — i.e. the immediately next audio in message order.
    let nextEntry: AudioEntry | null = null;
    for (const [, entry] of registryRef.current.entries()) {
      if (entry.orderIndex > current.orderIndex) {
        if (nextEntry === null || entry.orderIndex < nextEntry.orderIndex) {
          nextEntry = entry;
        }
      }
    }

    if (!nextEntry) return; // last audio — do nothing

    // Kick off the next audio. Reject gracefully so we don't throw an
    // unhandledrejection (e.g. if the source is unloadable).
    nextEntry.element.play().catch(() => {
      // Chain stops here; no further auto-advance is triggered.
    });
  }, []);

  return { registerAudio, unregisterAudio, handlePlay, handleEnded };
}
