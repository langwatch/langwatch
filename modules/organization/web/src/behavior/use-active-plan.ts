/** Plan tier and loading state: distinguish "loading" from "not Enterprise". */

import { useOrganizationHost } from "../model/organization-host.ts";

export type OrganizationActivePlanReading = {
  isEnterprise: boolean;
  isLoading: boolean;
};

export function useActivePlan(): OrganizationActivePlanReading {
  const host = useOrganizationHost();
  return { isEnterprise: host.isEnterprise(), isLoading: host.isPlanLoading() };
}
