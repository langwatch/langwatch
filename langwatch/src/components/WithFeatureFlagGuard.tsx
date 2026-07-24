import type React from "react";

import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";
import { LoadingScreen } from "./LoadingScreen";
import { NotFoundScene } from "./NotFoundScene";

interface WithFeatureFlagGuardOptions {
  /**
   * When true, the underlying `useOrganizationTeamProject` call does NOT
   * bounce a no-project admin to onboarding. Org-scope pages (governance)
   * set this so an admin without a project still reaches the page. Mirrors
   * the same flag on `withPermissionGuard`.
   */
  bypassOnboardingRedirect?: boolean;
}

/**
 * Higher-Order Component that hides a page behind a feature flag.
 *
 * The flag is org-targeted, so its query is gated on the org id being
 * resolved. The naive `if (!enabled) return <NotFoundScene />` pattern
 * flashes a 404 on every load: while the org context is still resolving the
 * flag query is disabled and `enabled` defaults to `false`, so the page
 * renders NotFoundScene for a frame before the flag settles. This guard waits
 * for BOTH the org context and the flag query to settle, and only renders
 * NotFoundScene once the flag has definitively resolved to off.
 *
 * Compose it OUTSIDE `withPermissionGuard` so a disabled flag reads as a 404
 * for everyone, before any permission check runs:
 *
 * ```tsx
 * export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
 *   bypassOnboardingRedirect: true,
 * })(withPermissionGuard("organization:manage", { ... })(Page));
 * ```
 */
export function withFeatureFlagGuard(
  flag: FrontendFeatureFlag,
  options?: WithFeatureFlagGuardOptions,
) {
  return function <P extends object>(WrappedComponent: React.ComponentType<P>) {
    const { bypassOnboardingRedirect = false } = options ?? {};

    const GuardedComponent = (props: P) => {
      const { organization, isLoading: orgLoading } =
        useOrganizationTeamProject(
          bypassOnboardingRedirect
            ? {
                redirectToOnboarding: false,
                redirectToProjectOnboarding: false,
              }
            : undefined,
        );
      const orgId = organization?.id ?? "";
      const { enabled, isLoading: ffLoading } = useFeatureFlag(flag, {
        organizationId: orgId,
        enabled: !!orgId,
      });

      if (orgLoading || (!!orgId && ffLoading)) {
        return <LoadingScreen />;
      }
      if (!enabled) {
        return <NotFoundScene />;
      }
      return <WrappedComponent {...props} />;
    };

    GuardedComponent.displayName = `withFeatureFlagGuard(${
      WrappedComponent.displayName ?? WrappedComponent.name ?? "Component"
    })`;

    return GuardedComponent;
  };
}
