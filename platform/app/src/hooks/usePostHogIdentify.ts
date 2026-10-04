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

/**
 * Whether `signed_in` still has to be sent for this user in this browser
 * session, marking it as sent. The flag holds the user id, so a different
 * user signing in on the same tab counts as a new sign in.
 */
function claimSignedIn(userId: string): boolean {
  if (signedInThisPageLoad.has(userId)) return false;
  signedInThisPageLoad.add(userId);
  try {
    if (window.sessionStorage.getItem(SIGNED_IN_STORAGE_KEY) === userId) {
      return false;
    }
    window.sessionStorage.setItem(SIGNED_IN_STORAGE_KEY, userId);
  } catch {
    // Storage unavailable: the in-memory set above is the only guard.
  }
  return true;
}

/**
 * Attribution for the `signed_in` event: the stored first-touch fields, with
 * the UTM and `ref` params of the current URL on top when it has any. An
 * email link opened in a tab that already holds first-touch values is still
 * reported under the campaign of that link.
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
  return toAttributionProperties({ ...readAttribution(), ...fromUrl });
}

/** Only exposed for testing. @internal */
export function resetSignedInTracking(): void {
  signedInThisPageLoad.clear();
}

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
