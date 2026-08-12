import type { ReactNode } from "react";
import { useCan } from "~/hooks/useCan";
import type { AuthzPermission } from "~/server/authz/registry";

/**
 * ADR-092 §5 — declarative permission gate backed by the engine-computed
 * effective permission set. Renders `fallback` (default: nothing) while
 * loading and on denial — fail closed by construction.
 *
 *   <RequireCan permission="prompts:update">
 *     <EditButton />
 *   </RequireCan>
 */
export function RequireCan({
  permission,
  children,
  fallback = null,
}: {
  permission: AuthzPermission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, isLoading } = useCan();
  if (isLoading || !can(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
