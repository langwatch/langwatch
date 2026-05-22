import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";
import { setPostHogImpersonationState } from "./usePostHog";

export function usePostHogIdentify({
  session,
  organization,
  planType,
  isAdmin,
}: {
  session: {
    user?: {
      id: string;
      email?: string | null;
      impersonator?: { id: string } | null;
    };
  } | null;
  organization: { id: string; name: string } | undefined;
  planType: string | undefined;
  isAdmin?: boolean;
}) {
  const prevUserIdRef = useRef<string | null>(null);
  const isImpersonating = !!session?.user?.impersonator;

  // Keep the module-level impersonation flag in sync for the before_send callback
  useEffect(() => {
    setPostHogImpersonationState(isImpersonating);
  }, [isImpersonating]);

  // 1. Identify user (skipped during impersonation)
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

    // Don't identify the impersonated user — this would pollute person properties
    if (isImpersonating) {
      prevUserIdRef.current = userId;
      return;
    }

    posthog.identify(userId, {
      email: session?.user?.email ?? undefined,
      is_admin: isAdmin ?? false,
    });
    prevUserIdRef.current = userId;
  }, [session?.user?.id, session?.user?.email, isImpersonating, isAdmin]);

  // 2. Group by organization (re-runs on org switch, skipped during impersonation)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !organization?.id) return;
    if (isImpersonating) return;

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
