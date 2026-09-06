import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

export function usePostHogIdentify({
  session,
  organization,
  planType,
}: {
  session: { user?: { id: string; email?: string | null } } | null;
  organization: { id: string; name: string } | undefined;
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

  // 3. Track upgrade modal opens via Zustand subscribe
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
