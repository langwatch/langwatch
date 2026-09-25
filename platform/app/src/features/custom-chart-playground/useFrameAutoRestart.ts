/**
 * Restart policy for a sandboxed chart frame the bridge tore down.
 *
 * A frame that stops heartbeating is usually a transient wedge (a CDN script
 * that hung, a busy loop on a pathological result), so the card restarts it
 * on its own with a growing pause between attempts and gives up after
 * {@link FRAME_RESTART_MAX_ATTEMPTS}. A frame that then stays healthy for
 * {@link FRAME_HEALTHY_RESET_MS} earns its attempts back, so a widget that
 * hiccups once a day never runs out of retries.
 *
 * Restarts wait while the tab is hidden: background-tab throttling is what
 * silenced the heartbeat in the first place, and remounting a frame nobody
 * can see would burn the attempt for nothing.
 *
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Pause before each automatic restart, by attempt. */
export const FRAME_RESTART_BACKOFF_MS = [1_000, 4_000, 15_000] as const;
export const FRAME_RESTART_MAX_ATTEMPTS = FRAME_RESTART_BACKOFF_MS.length;
/** How long a frame must stay responsive before earlier restarts are forgotten. */
export const FRAME_HEALTHY_RESET_MS = 60_000;

export type FrameRestartStatus =
  /** The frame is mounted (healthy, or not yet known to be otherwise). */
  | "running"
  /** Torn down; an automatic restart is scheduled. */
  | "restarting"
  /** Torn down; every automatic attempt was used up. */
  | "exhausted";

export interface FrameAutoRestart {
  readonly status: FrameRestartStatus;
  /** Automatic restarts performed since the frame was last healthy. */
  readonly attempts: number;
  /** The bridge tore the frame down. */
  readonly noteTornDown: () => void;
  /** A (re)mounted frame started its bridge — begins the healthy timer. */
  readonly noteFrameMounted: () => void;
  /** The member asked for a restart; resets the attempt budget. */
  readonly restartNow: () => void;
}

const isHidden = () =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

export function useFrameAutoRestart({
  onRestart,
}: {
  /** Remounts the frame. */
  readonly onRestart: () => void;
}): FrameAutoRestart {
  const [status, setStatus] = useState<FrameRestartStatus>("running");
  const [attempts, setAttempts] = useState(0);
  const attemptsRef = useRef(0);
  const onRestartRef = useRef(onRestart);
  onRestartRef.current = onRestart;
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingVisibility = useRef(false);

  const clearRestartTimer = () => {
    if (restartTimer.current !== null) clearTimeout(restartTimer.current);
    restartTimer.current = null;
  };
  const clearHealthyTimer = () => {
    if (healthyTimer.current !== null) clearTimeout(healthyTimer.current);
    healthyTimer.current = null;
  };

  const performRestart = useCallback(() => {
    attemptsRef.current += 1;
    setAttempts(attemptsRef.current);
    setStatus("running");
    onRestartRef.current();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (isHidden() || !awaitingVisibility.current) return;
      awaitingVisibility.current = false;
      performRestart();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearRestartTimer();
      clearHealthyTimer();
    };
  }, [performRestart]);

  const noteTornDown = useCallback(() => {
    clearHealthyTimer();
    const delay = FRAME_RESTART_BACKOFF_MS[attemptsRef.current];
    if (delay === undefined) {
      setStatus("exhausted");
      return;
    }
    setStatus("restarting");
    clearRestartTimer();
    restartTimer.current = setTimeout(() => {
      restartTimer.current = null;
      if (isHidden()) {
        awaitingVisibility.current = true;
        return;
      }
      performRestart();
    }, delay);
  }, [performRestart]);

  const noteFrameMounted = useCallback(() => {
    clearHealthyTimer();
    healthyTimer.current = setTimeout(() => {
      healthyTimer.current = null;
      attemptsRef.current = 0;
      setAttempts(0);
    }, FRAME_HEALTHY_RESET_MS);
  }, []);

  const restartNow = useCallback(() => {
    clearRestartTimer();
    awaitingVisibility.current = false;
    attemptsRef.current = 0;
    setAttempts(0);
    setStatus("running");
    onRestartRef.current();
  }, []);

  return { status, attempts, noteTornDown, noteFrameMounted, restartNow };
}
