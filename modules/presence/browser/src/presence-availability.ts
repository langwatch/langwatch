export type PresenceDisabledScope = "organization" | "project" | null;

export interface PresenceAvailability {
  /** True when presence is allowed for the current project. */
  enabled: boolean;
  /** Which level disabled it (organization wins over project), or null. */
  disabledAt: PresenceDisabledScope;
}

export function resolvePresenceAvailability({
  organizationPresenceEnabled,
  projectPresenceEnabled,
}: {
  organizationPresenceEnabled?: boolean | undefined;
  projectPresenceEnabled?: boolean | undefined;
}): PresenceAvailability {
  if (organizationPresenceEnabled === false) return { enabled: false, disabledAt: "organization" };
  if (projectPresenceEnabled === false) return { enabled: false, disabledAt: "project" };
  return { enabled: true, disabledAt: null };
}
