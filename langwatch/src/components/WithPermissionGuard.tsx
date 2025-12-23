import type React from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import type { Permission } from "../server/api/rbac";
import { PermissionAlert } from "./PermissionAlert";

interface WithPermissionGuardOptions {
  permission: Permission;
  fallbackComponent?: React.ComponentType<{
    permission: Permission;
    message?: string;
  }>;
  layoutComponent?: React.ComponentType<{ children: React.ReactNode }>;
  customMessage?: string;
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
    } = options ?? {};

    const GuardedComponent = (props: P) => {
      const { hasAnyPermission, isLoading } = useOrganizationTeamProject();

      // Don't check permissions while still loading - let the wrapped component handle loading state
      if (isLoading) {
        return <WrappedComponent {...props} />;
      }

      // Unified permission checker automatically routes to org or team permissions
      const hasRequiredPermission = hasAnyPermission(permission);

      if (!hasRequiredPermission) {
        const fallbackContent = (
          <FallbackComponent permission={permission} message={customMessage} />
        );

        // If a layout component is provided, wrap the fallback in it
        if (LayoutComponent) {
          return <LayoutComponent>{fallbackContent}</LayoutComponent>;
        }

        return fallbackContent;
      }

      return <WrappedComponent {...props} />;
    };

    GuardedComponent.displayName = `withPermissionGuard(${
      WrappedComponent.displayName ?? WrappedComponent.name ?? "Component"
    })`;

    return GuardedComponent;
  };
}
