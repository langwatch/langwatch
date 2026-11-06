import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import type { UiDeclarations } from "@langwatch/browser-host/declarations";
import { useLentHooks } from "@langwatch/browser-host/lent";
import { useActiveScope, useSession } from "@langwatch/browser-host/session";
import {
  FirstTouchAttributionToken,
  type FirstTouchAttribution,
} from "@langwatch/onboarding-client";
import { useEffect, useLayoutEffect, useRef } from "react";

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
  const attribution = useLentHooks(FirstTouchAttributionToken);
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

  // Every later event carries the project in view, so a board's events read per project.
  const projectId = scope.project?.id;
  // A layout effect, so it lands before any screen's own passive effects: React runs a child's
  // passive effects before its parent's, and a board's first viewed event must carry the project.
  useLayoutEffect(() => {
    // PostHog keeps a registered property across reloads, so a page that loads with no project
    // in view drops the one an earlier load left, rather than trusting an unmount that never ran.
    if (!userId || !projectId) {
      analytics.unregister("projectId");
      return;
    }
    analytics.register({ projectId });
    return () => analytics.unregister("projectId");
  }, [analytics, userId, projectId]);

  useEffect(() => () => analytics.reset(), [analytics]);
}

function isAttribution(value: unknown): value is FirstTouchAttribution {
  return typeof value === "object" && value !== null && "useCapture" in value;
}

/** Onboarding's lent first-touch attribution, read outside render; none without onboarding. */
export function lentFirstTouchAttribution(
  declarations: UiDeclarations,
): FirstTouchAttribution | undefined {
  const lend = declarations.lent(FirstTouchAttributionToken)[0]?.lend;
  return lend !== undefined && "value" in lend && isAttribution(lend.value)
    ? lend.value
    : undefined;
}
