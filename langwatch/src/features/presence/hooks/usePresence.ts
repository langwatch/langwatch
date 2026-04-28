import { useEffect, useRef } from "react";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import type {
  PresenceEvent,
  PresenceLocation,
} from "~/server/app-layer/presence/types";
import { api } from "~/utils/api";
import { usePresencePreferencesStore } from "../stores/presencePreferencesStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useTabSessionId } from "./useTabSessionId";

const HEARTBEAT_INTERVAL_MS = 15_000;
const LOCATION_DEBOUNCE_MS = 250;

interface UsePresenceOptions {
  projectId: string | null | undefined;
  location: PresenceLocation | null;
  enabled?: boolean;
}

/**
 * Wires the current browser tab into the project's multiplayer presence.
 *
 * - Generates a stable per-tab `sessionId` and announces it to peers.
 * - Re-publishes the supplied `location` whenever it changes (debounced).
 * - Sends a heartbeat every {@link HEARTBEAT_INTERVAL_MS} ms so the server-side
 *   TTL never expires while the tab is open.
 * - Subscribes to peer updates and feeds them into {@link usePresenceStore}.
 * - Sends a `leave` on unmount and on `pagehide` so peers see drop-offs
 *   immediately rather than waiting for TTL.
 */
export function usePresence({
  projectId,
  location,
  enabled = true,
}: UsePresenceOptions): void {
  const sessionId = useTabSessionId();

  const setSelfSessionId = usePresenceStore((s) => s.setSelfSessionId);
  const applyEvent = usePresenceStore((s) => s.applyEvent);
  const reset = usePresenceStore((s) => s.reset);

  const updateMutation = api.presence.update.useMutation();
  const leaveMutation = api.presence.leave.useMutation();

  const updateRef = useRef(updateMutation.mutateAsync);
  updateRef.current = updateMutation.mutateAsync;
  const leaveRef = useRef(leaveMutation.mutateAsync);
  leaveRef.current = leaveMutation.mutateAsync;

  const lastLocationRef = useRef<PresenceLocation | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hidden = usePresencePreferencesStore((s) => s.hidden);

  const active = Boolean(
    enabled && projectId && sessionId && location && !hidden,
  );

  useEffect(() => {
    if (active && sessionId) setSelfSessionId(sessionId);
    return () => setSelfSessionId(null);
  }, [active, sessionId, setSelfSessionId]);

  // SSE subscription: feed every delta into the local store.
  useSSESubscription<PresenceEvent, { projectId: string }>(
    // @ts-expect-error - tRPC subscription type mismatch with hook signature
    api.presence.onPresenceUpdate,
    { projectId: projectId ?? "" },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => applyEvent(data),
      onStopped: () => reset(),
      onError: () => reset(),
    },
  );

  // Push location updates: immediate on first send, debounced thereafter.
  useEffect(() => {
    if (!active || !projectId || !location) return;

    const same =
      lastLocationRef.current &&
      JSON.stringify(lastLocationRef.current) === JSON.stringify(location);
    if (same) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      lastLocationRef.current = location;
      void updateRef.current({
        projectId,
        sessionId,
        location,
      });
    }, LOCATION_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [active, projectId, sessionId, location]);

  // Heartbeat: re-send the last known location so TTL never expires.
  useEffect(() => {
    if (!active || !projectId) return;

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const last = lastLocationRef.current;
      if (!last) return;
      void updateRef.current({ projectId, sessionId, location: last });
    }, HEARTBEAT_INTERVAL_MS);

    // Re-announce immediately when the tab becomes visible — otherwise peers
    // won't see us again until the next heartbeat tick (and may have already
    // TTL-evicted us if we were hidden for >30s).
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastLocationRef.current;
      if (!last) return;
      void updateRef.current({ projectId, sessionId, location: last });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, projectId, sessionId]);

  // Best-effort leave on tab close / unmount.
  useEffect(() => {
    if (!active || !projectId) return;

    const leave = () => {
      // Clear debounced update so a stale location doesn't get sent after leave.
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // Drop the cached location so re-activating (e.g. after un-hiding)
      // forces a fresh announce instead of dedup-skipping.
      lastLocationRef.current = null;
      void leaveRef.current({ projectId, sessionId }).catch(() => {
        // Ignore — server-side TTL will reclaim the session anyway.
      });
    };

    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [active, projectId, sessionId]);

}

