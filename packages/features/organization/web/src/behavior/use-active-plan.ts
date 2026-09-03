/**
 * `useActivePlan`, narrowed to the tier and whether the answer has arrived.
 *
 * The groups page gates its whole table on Enterprise, and the pair matters:
 * still-arriving is a third state, and reading it as "not Enterprise" pitches
 * an upgrade at a customer who already bought it for the length of a round
 * trip. Both come off the host, which reads them on the application's own
 * transport under the key `limits.getUsage` already occupies.
 */

import { useOrganizationHost } from "../model/organization-host";

export type OrganizationActivePlanReading = {
  isEnterprise: boolean;
  isLoading: boolean;
};

export function useActivePlan(): OrganizationActivePlanReading {
  const host = useOrganizationHost();
  return { isEnterprise: host.isEnterprise(), isLoading: host.isPlanLoading() };
}
