/** Session reading from host: returns signed-in user in preserved shape. */

import { useMemo } from "react";

import { useOrganizationHost, type OrganizationActor } from "../model/organization-host.ts";

export type OrganizationSessionReading = {
  data: { user: OrganizationActor } | undefined;
};

export function useRequiredSession(): OrganizationSessionReading {
  const host = useOrganizationHost();
  const user = host.currentUser();
  return useMemo(() => ({ data: user ? { user } : void 0 }), [user]);
}
