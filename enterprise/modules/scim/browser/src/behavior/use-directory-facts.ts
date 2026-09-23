// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The directory card's three reads, and the facts drawn from them. Groups and
 * provenance are `organization:manage` reads: a reader without it gets the
 * other facts and an honest word rather than a zero.
 */
import { directoryFactsOf } from "../model/directory-facts.ts";
import { directoryMembershipApi, scimApi } from "./scim-api.ts";

export function useDirectoryFacts({
  organizationId,
  canReadMembership,
}: {
  organizationId: string;
  canReadMembership: boolean;
}) {
  const reconciliation = scimApi.scimReconciliation.getAll.useQuery({ organizationId });
  const groups = directoryMembershipApi.group.listAll.useQuery(
    { organizationId },
    { enabled: canReadMembership && !!organizationId },
  );
  const provenance = directoryMembershipApi.organization.getMemberProvenance.useQuery(
    { organizationId },
    { enabled: canReadMembership && !!organizationId },
  );

  return {
    reconciliation,
    groups,
    provenance,
    ...directoryFactsOf({
      connections: reconciliation.data?.connections ?? [],
      groups: groups.data ?? [],
      provenance: provenance.data ?? {},
    }),
  };
}
