import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { parseOnboardingVariant } from "~/server/schemas/sign-up-data.schema";
import {
  type AttributionField,
  readAttribution,
  toAttributionProperties,
  URL_PARAM_TO_FIELD,
} from "~/utils/attribution";
import { registerOnboardingExperiment } from "~/utils/onboardingExperimentRegistration";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

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
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
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
    window.sessionStorage.setItem(
      SIGNED_IN_STORAGE_KEY,
      JSON.stringify([...userIds, userId]),
    );
  } catch {
    // Storage unavailable: the in-memory set above is the only guard.
  }
  return true;
}

/**
 * Attribution for the `signed_in` event, taken from one source as a whole so
 * two campaigns are never mixed: the UTM and `ref` params of the current URL
 * when it has any, otherwise the stored first-touch fields. An email link
 * opened in a tab that already holds first-touch values is reported under
 * the campaign of that link only.
 */
function signedInAttribution(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const fromUrl: Partial<Record<AttributionField, string>> = {};
  for (const [urlParam, field] of Object.entries(URL_PARAM_TO_FIELD) as [
    string,
    AttributionField,
  ][]) {
    const value = params.get(urlParam);
    if (value) fromUrl[field] = value;
  }
  return toAttributionProperties(
    Object.keys(fromUrl).length > 0 ? fromUrl : readAttribution(),
  );
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
 * Keeps PostHog in step with the session: identifies the user, groups by
 * organization, registers the onboarding variant, and captures `signed_in`
 * and `upgrade_modal_shown`.
 */
export function usePostHogIdentify({
  session,
  organization,
  planType,
}: {
  session: { user?: { id: string; email?: string | null } } | null;
  organization: { id: string; name: string; signupData?: unknown } | undefined;
  planType: string | undefined;
}) {
  const prevUserIdRef = useRef<string | null>(null);

  // 1. Identify user
  useEffect(() => {
    if (typeof window === "undefined") return;

    const userId = session?.user?.id;
    const prevUserId = prevUserIdRef.current;

    // Detect logout or user switch: reset PostHog state
    if (prevUserId && prevUserId !== userId) {
      posthog.reset();
    }

    if (!userId) {
      prevUserIdRef.current = null;
      return;
    }

    posthog.identify(userId, {
      email: session?.user?.email ?? undefined,
    });
    prevUserIdRef.current = userId;

    // One `signed_in` per browser session for an identified user: the step
    // between an email click and the later sign up or payment milestones.
    if (claimSignedIn(userId)) {
      posthog.capture("signed_in", signedInAttribution());
    }
  }, [session?.user?.id, session?.user?.email]);

  // 2. Group by organization (re-runs on org switch)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !organization?.id) return;

    posthog.group("organization", organization.id, {
      name: organization.name,
      ...(planType ? { planType } : {}),
    });
  }, [session?.user?.id, organization?.id, organization?.name, planType]);

  // 3. Register the onboarding experiment variant the organization recorded,
  // so every event captured from the browser carries it (re-runs on org
  // switch). An organization without a variant clears the property.
  const onboardingVariant = parseOnboardingVariant(organization?.signupData);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !organization?.id) return;

    registerOnboardingExperiment(onboardingVariant);
  }, [session?.user?.id, organization?.id, onboardingVariant]);

  // 4. Track upgrade modal opens via Zustand subscribe
  useEffect(() => {
    const unsubscribe = useUpgradeModalStore.subscribe((state, prevState) => {
      if (typeof window === "undefined") return;
      if (state.isOpen && !prevState.isOpen && state.variant) {
        posthog.capture("upgrade_modal_shown", {
          mode: state.variant.mode,
          ...(state.variant.mode === "limit"
            ? {
                limitType: state.variant.limitType,
                current: state.variant.current,
                max: state.variant.max,
              }
            : {}),
        });
      }
    });
    return unsubscribe;
  }, []);
}
