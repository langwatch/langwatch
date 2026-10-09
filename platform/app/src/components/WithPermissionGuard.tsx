import type { AuthzPermission as Permission } from "@langwatch/authz";
import type React from "react";
import {
  productById,
  productFromPathname,
  seatReachesProduct,
} from "~/features/navigation/products";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { PermissionAlert } from "./PermissionAlert";

interface WithPermissionGuardOptions {
  permission: Permission;
  fallbackComponent?: React.ComponentType<{
    permission: Permission;
    message?: string;
  }>;
  layoutComponent?: React.ComponentType<{ children: React.ReactNode }>;
  customMessage?: string;
  /**
   * When true, the underlying `useOrganizationTeamProject` call inside
   * the guard does NOT trigger the no-org/no-project bouncer to
   * `/onboarding/welcome`. Used by org-scope pages (governance) where
   * an admin may exist in an org without any project yet — they must
   * still reach `/governance` to set up sources / rules. The default
   * (false) preserves the legacy behavior for project-scope pages.
   */
  bypassOnboardingRedirect?: boolean;
}

/**
 * The seat gate on top of the permission gate. The permission is answered on
 * the project in view, and a Developer (ADR-143) holds a member's permissions
 * inside their own project, so `virtualKeys:view` alone would let them onto
 * an organization-wide product. The product registry says which seats reach
 * which product; a page that belongs to no product is not seat-gated here.
 */
function seatReachesPage({
  pathname,
  organizationRole,
}: {
  pathname: string | undefined;
  organizationRole: Parameters<
    typeof seatReachesProduct
  >[0]["organizationRole"];
}): boolean {
  // A page the router cannot place belongs to no product; the permission
  // gate alone decides it.
  const productId = pathname ? productFromPathname(pathname) : null;
  if (!productId) return true;
  return seatReachesProduct({
    product: productById(productId),
    organizationRole,
  });
}

/**
 * Higher-Order Component that guards components based on user permissions
 * Single Responsibility: Provide permission-based access control for wrapped components
 *
 * @param permission - The permission required to access the component
 * @param options - Optional configuration for fallback UI and layout
 * @returns A function that wraps components with permission checking
 */
export function withPermissionGuard(
  permission: Permission,
  options?: Omit<WithPermissionGuardOptions, "permission">,
) {
  return function <P extends object>(WrappedComponent: React.ComponentType<P>) {
    const {
      fallbackComponent: FallbackComponent = PermissionAlert,
      layoutComponent: LayoutComponent,
      customMessage,
      bypassOnboardingRedirect = false,
    } = options ?? {};

    const contextOptions = bypassOnboardingRedirect
      ? { redirectToOnboarding: false, redirectToProjectOnboarding: false }
      : undefined;

    const Fallback = () => {
      const fallbackContent = (
        <FallbackComponent permission={permission} message={customMessage} />
      );
      // If a layout component is provided, wrap the fallback in it
      return LayoutComponent ? (
        <LayoutComponent>{fallbackContent}</LayoutComponent>
      ) : (
        fallbackContent
      );
    };

    const GuardedComponent = (props: P) => {
      const { pathname } = useRouter();
      const { hasAnyPermission, organizationRole, isLoading } =
        useOrganizationTeamProject(contextOptions);

      // Don't check permissions while still loading - let the wrapped component handle loading state
      // Unified permission checker automatically routes to org or team permissions
      const isAllowed =
        isLoading ||
        (hasAnyPermission(permission) &&
          seatReachesPage({ pathname, organizationRole }));

      return isAllowed ? <WrappedComponent {...props} /> : <Fallback />;
    };

    GuardedComponent.displayName = `withPermissionGuard(${
      WrappedComponent.displayName ?? WrappedComponent.name ?? "Component"
    })`;

    return GuardedComponent;
  };
}
