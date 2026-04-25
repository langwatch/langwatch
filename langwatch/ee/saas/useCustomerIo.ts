import { AnalyticsBrowser } from "@customerio/cdp-analytics-browser";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

// Module-level singleton — initialized once, reused across renders.
// Same pattern as posthog-js (usePostHog.ts).
let cioInstance: AnalyticsBrowser | null = null;

/**
 * Initializes the Customer.io client-side SDK for in-app messaging.
 *
 * - Identifies the user and tracks SPA page navigations so Customer.io
 *   can target in-app messages by identity and page rules.
 * - Impersonation-aware: resets identity and stops all tracking when an
 *   admin is impersonating another user.
 * - SaaS-only: the caller (ExtraFooterComponents) gates on IS_SAAS
 *   before rendering; this hook is never called for self-hosted.
 */
export function useCustomerIo({
  writeKey,
  siteId,
  user,
  organization,
  isImpersonating,
  enabled,
}: {
  writeKey: string;
  siteId: string;
  user: { id: string; email?: string | null; name?: string | null };
  organization?: { id: string; name: string };
  isImpersonating: boolean;
  enabled: boolean;
}) {
  const location = useLocation();
  const identifiedUserRef = useRef<string | null>(null);

  // 1. Initialize SDK (once, guarded against impersonation and missing config)
  useEffect(() => {
    if (!enabled || isImpersonating || cioInstance) return;

    cioInstance = AnalyticsBrowser.load(
      { writeKey, cdnURL: "https://cdp-eu.customer.io" },
      {
        integrations: {
          "Customer.io In-App Plugin": { siteId },
        },
      },
    );
  }, [writeKey, siteId, isImpersonating, enabled]);

  // 2. Identify user (re-runs on user/org change, handles logout/switch)
  useEffect(() => {
    if (!enabled || !cioInstance) return;

    if (isImpersonating) {
      cioInstance.reset();
      identifiedUserRef.current = null;
      return;
    }

    const prevUserId = identifiedUserRef.current;
    if (prevUserId && prevUserId !== user.id) {
      cioInstance.reset();
    }

    cioInstance.identify(user.id, {
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      ...(organization
        ? {
            organization_id: organization.id,
            organization_name: organization.name,
          }
        : {}),
    });
    identifiedUserRef.current = user.id;
  }, [
    user.id,
    user.email,
    user.name,
    organization?.id,
    organization?.name,
    isImpersonating,
    enabled,
  ]);

  // 3. Page tracking (SPA route changes)
  useEffect(() => {
    if (!enabled || isImpersonating || !cioInstance) return;
    cioInstance.page();
  }, [location.pathname, isImpersonating, enabled]);
}
