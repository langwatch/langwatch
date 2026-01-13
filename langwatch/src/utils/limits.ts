/**
 * Utility functions for checking project and organization limits.
 */

export type UsageData = {
  projectsCount: number;
  activePlan: {
    maxProjects: number;
    overrideAddingLimitations?: boolean;
  };
};

/**
 * Checks if the organization has reached the maximum number of projects allowed.
 * Returns false if usage data is not available (allows creation while loading).
 */
export function isAtMaxProjects(usage: UsageData | undefined): boolean {
  if (!usage) return false;
  return (
    usage.projectsCount >= usage.activePlan.maxProjects &&
    !usage.activePlan.overrideAddingLimitations
  );
}

/**
 * Checks if the organization can add more projects.
 * Returns true if usage data is not available (allows creation while loading).
 */
export function canAddProjects(usage: UsageData | undefined): boolean {
  return !isAtMaxProjects(usage);
}
