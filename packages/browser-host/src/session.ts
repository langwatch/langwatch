import type { UiActor } from "./capabilities.ts";
import { useUiCapabilities } from "./capabilities.ts";

export type UiSessionStatus = "loading" | "authenticated" | "anonymous" | "offline" | "error";

export type UiScopeStatus = "loading" | "ready" | "unavailable";

export type UiSessionScopeOrganization = Readonly<{ id: string; name?: string }>;
export type UiSessionScopeTeam = Readonly<{ id: string; name?: string }>;
export type UiSessionScopeProject = Readonly<{ id: string; slug: string; name: string }>;

export type UiSessionReading =
  | Readonly<{
      status: "authenticated";
      user: UiActor;
    }>
  | Readonly<{
      status: Exclude<UiSessionStatus, "authenticated">;
      user: null;
    }>;

export type UiActiveScopeReading = Readonly<{
  status: UiScopeStatus;
  organization: UiSessionScopeOrganization | undefined;
  team: UiSessionScopeTeam | undefined;
  project: UiSessionScopeProject | undefined;
}>;

export type UiPermissionsReading = Readonly<{
  status: "loading" | "ready" | "unavailable";
  isLoading: boolean;
  can(permission: string): boolean;
  canInOrganization(permission: string): boolean;
}>;

export type UiSessionSnapshot = Readonly<{
  session: UiSessionReading;
  scope: UiActiveScopeReading;
  permissions: UiPermissionsReading;
}>;

/** Reads the session snapshot the application's one capability publisher resolved. */
export function useSession(): UiSessionReading {
  return useUiSessionSnapshot().session;
}

/** Reads the active scope from the application's one capability publisher. */
export function useActiveScope(): UiActiveScopeReading {
  return useUiSessionSnapshot().scope;
}

/** Reads fail-closed grants from the application's one capability publisher. */
export function usePermissions(): UiPermissionsReading {
  return useUiSessionSnapshot().permissions;
}

function useUiSessionSnapshot(): UiSessionSnapshot {
  const { session } = useUiCapabilities();
  return session.snapshot();
}
