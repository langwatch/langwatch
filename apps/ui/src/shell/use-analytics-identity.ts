import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import { useActiveScope, useSession } from "@langwatch/browser-host/session";
import { useEffect, useRef } from "react";

const SIGNED_IN_STORAGE_KEY = "lw_posthog.signed_in";

/**
 * User ids that already sent `signed_in` from this page load. Keeps the event
 * at one per load when sessionStorage is unavailable (private browsing).
 */
const signedInThisPageLoad = new Set<string>();

/** User ids that already sent `signed_in` in this browser session. */
function readSignedInUserIds(): string[] {
  const stored = window.sessionStorage.getItem(SIGNED_IN_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);

    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Whether `signed_in` still has to be sent for this user in this browser
 * session, marking it as sent. The record is per user, so several users
 * signing in on the same tab each count once.
 */
function claimSignedIn(userId: string): boolean {
  if (signedInThisPageLoad.has(userId)) return false;
  signedInThisPageLoad.add(userId);

  try {
    const userIds = readSignedInUserIds();
    if (userIds.includes(userId)) return false;
    window.sessionStorage.setItem(SIGNED_IN_STORAGE_KEY, JSON.stringify([...userIds, userId]));
  } catch {
    // Storage unavailable: the in-memory set above is the only guard.
  }

  return true;
}

/**
 * Forgets which users sent `signed_in` during this page load, which is what a
 * reload does. Only exposed for testing.
 * @internal
 */
export function resetSignedInTracking(): void {
  signedInThisPageLoad.clear();
}

/**
 * Tells analytics who is reading and which organization they are in, from the
 * session the shell resolved: a person signing in is identified, a switch to
 * another person resets first, and leaving the signed-in application forgets them.
 */
export function useAnalyticsIdentity(): void {
  const analytics = useUiAnalytics();
  const session = useSession();
  const scope = useActiveScope();
  const attribution = useUiDeclarations().declared("firstTouchAttribution")[0]?.capability;
  const previousUserId = useRef<string | null>(null);

  const userId = session.user?.id ?? null;
  const email = session.user?.email ?? null;
  useEffect(() => {
    if (previousUserId.current && previousUserId.current !== userId) analytics.reset();
    previousUserId.current = userId;
    if (!userId) return;

    analytics.identify({ id: userId, email });
    // The step between an email click and the later sign up or payment milestones.
    if (claimSignedIn(userId)) {
      analytics.track({ name: "signed_in", attributes: attribution?.eventProperties() ?? {} });
    }
  }, [analytics, attribution, userId, email]);

  const organizationId = scope.organization?.id;
  const organizationName = scope.organization?.name;
  useEffect(() => {
    if (!userId || !organizationId) return;
    analytics.group({ id: organizationId, name: organizationName });
  }, [analytics, userId, organizationId, organizationName]);

  useEffect(() => () => analytics.reset(), [analytics]);
}
