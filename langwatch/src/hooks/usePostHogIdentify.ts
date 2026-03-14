import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

export function usePostHogIdentify({
  session,
  organization,
  planType,
}: {
  session: {
    user?: {
      id: string;
      email?: string | null;
      impersonator?: { email?: string | null };
    };
  } | null;
  organization: { id: string; name: string } | undefined;
  planType: string | undefined;
}) {
  const prevUserIdRef = useRef<string | null>(null);
  const wasImpersonatingRef = useRef(false);

  const isImpersonating = !!session?.user?.impersonator;

  // 1. Identify user (or suppress during impersonation)
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isImpersonating) {
      posthog.opt_out_capturing();
      wasImpersonatingRef.current = true;
      return;
    }

    posthog.opt_in_capturing();

    // Transitioning from impersonated back to normal: reset before re-identifying
    if (wasImpersonatingRef.current) {
      posthog.reset();
      wasImpersonatingRef.current = false;
    }

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
  }, [session?.user?.id, session?.user?.email, isImpersonating]);

  // 2. Group by organization (re-runs on org switch)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isImpersonating) return;
    if (!session?.user?.id || !organization?.id) return;

    posthog.group("organization", organization.id, {
      name: organization.name,
      ...(planType ? { planType } : {}),
    });
  }, [
    session?.user?.id,
    organization?.id,
    organization?.name,
    planType,
    isImpersonating,
  ]);

  // 3. Track upgrade modal opens via Zustand subscribe
  useEffect(() => {
    const unsubscribe = useUpgradeModalStore.subscribe((state, prevState) => {
      if (typeof window === "undefined") return;
      if (isImpersonating) return;
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
  }, [isImpersonating]);
}
