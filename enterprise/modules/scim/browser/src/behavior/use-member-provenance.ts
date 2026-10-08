// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Why each member is here, composed in the browser from organization's invited ids and identity's
 * join admissions (round 24 EF-3); `organization.getMemberProvenance` is retired.
 */
import { memberProvenanceFor } from "@langwatch/organization-contract";
import { useMemo } from "react";

import { directoryMembershipApi } from "./scim-api.ts";

export function useMemberProvenance({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  const invited = directoryMembershipApi.organization.getInvitedMemberIds.useQuery(
    { organizationId },
    { enabled },
  );
  const admissions = directoryMembershipApi.identity.getJoinAdmissions.useQuery(
    { organizationId },
    { enabled },
  );
  const data = useMemo(
    () =>
      invited.data && admissions.data
        ? memberProvenanceFor({
            userIds: invited.data.memberUserIds,
            invitedUserIds: invited.data.invitedUserIds,
            admissions: admissions.data,
          })
        : undefined,
    [invited.data, admissions.data],
  );

  return {
    data,
    isLoading: invited.isLoading || admissions.isLoading,
    isError: invited.isError || admissions.isError,
    error: invited.error ?? admissions.error ?? null,
    refetch: () => Promise.all([invited.refetch(), admissions.refetch()]),
  };
}
