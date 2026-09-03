/**
 * `useRequiredSession`, answered off the host port.
 *
 * The platform hook carried a two-hundred-line public-route table and a
 * sign-in redirect; neither travels, for the reason the traces family gave —
 * that is landing policy and belongs to whatever serves the address. What the
 * two call sites here read is the signed-in user, so that is what this answers,
 * in the same `{ data: { user } }` shape so neither call site changed.
 */

import { useMemo } from "react";
import { useOrganizationHost, type OrganizationActor } from "../model/organization-host";

export type OrganizationSessionReading = {
  data: { user: OrganizationActor } | undefined;
};

export function useRequiredSession(): OrganizationSessionReading {
  const host = useOrganizationHost();
  const user = host.currentUser();
  return useMemo(() => ({ data: user ? { user } : void 0 }), [user]);
}
