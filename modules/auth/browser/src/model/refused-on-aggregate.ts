import { isRegistryPermission, permissionGrantTiers } from "@langwatch/authorization";
import { writesUnderProject } from "@langwatch/project-contract";

/**
 * Whether a control declared under this permission is hidden on an aggregate
 * (ADR-175 decision 8). An organisation-level write names no project, so the
 * server lets it through on an aggregate and the client does too.
 */
export function refusedOnAggregate(permission: string): boolean {
  if (!isRegistryPermission(permission)) return false;
  const tiers = permissionGrantTiers(permission);
  const organizationOnly = tiers.length === 1 && tiers[0] === "organization";
  return !organizationOnly && writesUnderProject(permission);
}
