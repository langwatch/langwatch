import { AnalyticsBrowser } from "@customerio/cdp-analytics-browser";
import { useEffect } from "react";
import { useLocation } from "react-router";

// Module-scoped state — survives component unmount/remount cycles.
// The SDK instance is a singleton (one AnalyticsBrowser.load per page).
// The identity tracker ensures reset() fires on cross-session user switch
// (User A logs out → User B logs in on same browser tab).
let cioInstance: AnalyticsBrowser | null = null;
let identifiedProfileId: string | null = null;

/**
 * Initializes the Customer.io client-side SDK for in-app messaging.
 *
 * - Identifies the user via an HMAC'd external profile ID (not the raw
 *   userId) to prevent cross-user write attacks via the public CDP key.
 * - Tracks SPA page navigations for in-app message targeting.
 * - Impersonation-aware: resets identity and stops all tracking when an
 *   admin is impersonating another user.
 * - SaaS-only: the caller (ExtraFooterComponents) gates on IS_SAAS
 *   before rendering; this hook is never called for self-hosted.
 */
export function useCustomerIo({
  writeKey,
  siteId,
  externalProfileId,
  user,
  organization,
  isImpersonating,
  enabled,
}: {
  writeKey: string;
  siteId: string;
  externalProfileId: string;
  user: { email?: string | null; name?: string | null };
  organization?: { id: string; name: string };
  isImpersonating: boolean;
  enabled: boolean;
}) {
  const location = useLocation();

  // 1. Initialize SDK (once, guarded against impersonation and missing config)
  useEffect(() => {
    if (!enabled || isImpersonating || cioInstance) return;

    // Hardcoded EU CDN — our Customer.io workspace is EU, matching the
    // server-side NurturingService default. No need for region config.
    cioInstance = AnalyticsBrowser.load(
      { writeKey, cdnURL: "https://cdp-eu.customer.io" },
      {
        integrations: {
          "Customer.io In-App Plugin": { siteId },
        },
      },
    );
  }, [writeKey, siteId, isImpersonating, enabled]);

  // 2. Identify user (re-runs on profile ID or org change)
  useEffect(() => {
    if (!enabled || !cioInstance || !externalProfileId) return;

    if (isImpersonating) {
      cioInstance.reset();
      identifiedProfileId = null;
      return;
    }

    // Detect user switch (including cross-session: User A logs out,
    // User B logs in). identifiedProfileId is module-scoped so it
    // survives the component unmount/remount between logout and login.
    if (identifiedProfileId && identifiedProfileId !== externalProfileId) {
      cioInstance.reset();
    }

    cioInstance.identify(externalProfileId, {
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      ...(organization
        ? {
            organization_id: organization.id,
            organization_name: organization.name,
          }
        : {}),
    });
    identifiedProfileId = externalProfileId;
  }, [
    externalProfileId,
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
