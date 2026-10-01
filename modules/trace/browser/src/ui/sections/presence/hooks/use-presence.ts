import type { PresenceEvent, PresenceLocation } from "@langwatch/presence-contract";
import { useSSESubscription } from "@langwatch/trace-browser-kit";
import { type RefObject, useEffect, useMemo, useRef } from "react";

import { usePresencePreferencesStore } from "../../../../behavior/presence/presence-preferences-store.ts";
import { usePresenceStore } from "../../../../behavior/presence/presence-store.ts";
import { useTabSessionId } from "../../../../behavior/presence/use-tab-session-id.ts";
import { api } from "../../../../behavior/trace-api.ts";

const HEARTBEAT_INTERVAL_MS = 15_000;
const LOCATION_DEBOUNCE_MS = 250;

interface UsePresenceOptions {
  projectId: string | null | undefined;
  location: PresenceLocation | null;
  enabled?: boolean;
}

type PresenceUpdate = (input: {
  projectId: string;
  sessionId: string;
  location: PresenceLocation;
}) => Promise<unknown>;
type PresenceLeave = (input: { projectId: string; sessionId: string }) => Promise<unknown>;

/** What the tab last announced and the announce still pending, shared by the effects below. */
type Announcement = {
  lastLocation: RefObject<PresenceLocation | null>;
  debounceTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  update: RefObject<PresenceUpdate>;
  leave: RefObject<PresenceLeave>;
};

/**
 * Leaves presence: drops the pending announce so a stale location is not sent
 * after, and the cached one so re-activating announces afresh. A failure is
 * ignored; the server's TTL reclaims the session anyway.
 */
function leavePresence({
  announcement,
  projectId,
  sessionId,
}: {
  announcement: Announcement;
  projectId: string;
  sessionId: string;
}) {
  if (announcement.debounceTimer.current) clearTimeout(announcement.debounceTimer.current);
  announcement.lastLocation.current = null;
  void announcement.leave.current({ projectId, sessionId }).catch(() => undefined);
}

/**
 * Heartbeat and location updates ride the persistent tRPC WebSocket: at many
 * tabs, one HTTP call per update was noticeable traffic.
 */
function useAnnouncement(): Announcement {
  const updateMutation = api.presence.update.useMutation({ trpc: { context: { useWS: true } } });
  const leaveMutation = api.presence.leave.useMutation({ trpc: { context: { useWS: true } } });
  const update = useRef<PresenceUpdate>(updateMutation.mutateAsync);
  update.current = updateMutation.mutateAsync;
  const leave = useRef<PresenceLeave>(leaveMutation.mutateAsync);
  leave.current = leaveMutation.mutateAsync;
  const lastLocation = useRef<PresenceLocation | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One stable object: the refs never change, so neither may what holds them.
  return useMemo(() => ({ lastLocation, debounceTimer, update, leave }), []);
}

/** Pushes a changed location, debounced; an unchanged one is not re-sent. */
function useLocationPush({
  announcement,
  target,
  location,
}: {
  announcement: Announcement;
  target: { projectId: string; sessionId: string } | undefined;
  location: PresenceLocation | null;
}) {
  const projectId = target?.projectId;
  const sessionId = target?.sessionId;
  useEffect(() => {
    if (!projectId || !sessionId || !location) return;
    const last = announcement.lastLocation.current;
    if (last && JSON.stringify(last) === JSON.stringify(location)) return;
    const timer = announcement.debounceTimer;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      announcement.lastLocation.current = location;
      void announcement.update.current({ projectId, sessionId, location });
    }, LOCATION_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [announcement, projectId, sessionId, location]);
}

/**
 * Re-sends the last location on a heartbeat so the TTL never lapses, and at
 * once when the tab becomes visible again, so peers see it before the next tick.
 */
function useHeartbeat({
  announcement,
  target,
}: {
  announcement: Announcement;
  target: { projectId: string; sessionId: string } | undefined;
}) {
  const projectId = target?.projectId;
  const sessionId = target?.sessionId;
  useEffect(() => {
    if (!projectId || !sessionId) return;
    const resend = () => {
      const last = announcement.lastLocation.current;
      if (document.visibilityState !== "visible" || !last) return;
      void announcement.update.current({ projectId, sessionId, location: last });
    };
    const interval = setInterval(resend, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", resend);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", resend);
    };
  }, [announcement, projectId, sessionId]);
}

/**
 * Wires the current browser tab into the project's multiplayer presence.
 */
export function usePresence({ projectId, location, enabled = true }: UsePresenceOptions): void {
  const sessionId = useTabSessionId();
  const setSelfSessionId = usePresenceStore((s) => s.setSelfSessionId);
  const applyEvent = usePresenceStore((s) => s.applyEvent);
  const reset = usePresenceStore((s) => s.reset);
  const hidden = usePresencePreferencesStore((s) => s.hidden);
  const announcement = useAnnouncement();

  const active = Boolean(enabled && projectId && sessionId && location && !hidden);
  const target = useMemo(
    () => (active && projectId && sessionId ? { projectId, sessionId } : undefined),
    [active, projectId, sessionId],
  );

  useEffect(() => {
    if (target) setSelfSessionId(target.sessionId);
    return () => setSelfSessionId(null);
  }, [target, setSelfSessionId]);

  // Every delta from the SSE feed goes into the local store.
  useSSESubscription<PresenceEvent, { projectId: string }>(
    api.presence.onPresenceUpdate,
    { projectId: projectId ?? "" },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => applyEvent(data),
      onStopped: () => reset(),
      onError: () => reset(),
    },
  );

  useLocationPush({ announcement, target, location });
  useHeartbeat({ announcement, target });

  // Hiding leaves at once rather than waiting for peers to TTL-evict the tab;
  // only the visible-to-hidden transition does.
  const previouslyHiddenRef = useRef(hidden);
  useEffect(() => {
    const wasHidden = previouslyHiddenRef.current;
    previouslyHiddenRef.current = hidden;
    if (!hidden || wasHidden || !projectId || !sessionId) return;
    leavePresence({ announcement, projectId, sessionId });
  }, [announcement, hidden, projectId, sessionId]);

  // Best-effort leave on tab close and unmount.
  useEffect(() => {
    if (!target) return;
    const leave = () => leavePresence({ announcement, ...target });
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [announcement, target]);
}
