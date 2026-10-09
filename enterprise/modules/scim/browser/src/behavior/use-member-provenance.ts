// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Why each member is here, composed in the browser from organization's invited ids and identity's
 * join admissions (round 24 EF-3); `organization.getMemberProvenance` is retired.
 */
import { identityClient } from "@langwatch/identity-client";
import { memberProvenanceFor } from "@langwatch/organization-contract";
import { useMemo } from "react";

import { directoryMembershipApi } from "./scim-api.ts";

/** Member ids per admissions request, so a large organization never sends one oversized ask. */
const ADMISSIONS_CHUNK = 200;

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
  // Asked for the members organization named, so the answer covers nobody else (round 31 ID-1).
  const chunks = useMemo(() => {
    const memberUserIds = invited.data?.memberUserIds ?? [];
    const out: string[][] = [];
    for (let at = 0; at < memberUserIds.length; at += ADMISSIONS_CHUNK) {
      out.push(memberUserIds.slice(at, at + ADMISSIONS_CHUNK));
    }
    return out;
  }, [invited.data]);
  const pages = identityClient.useQueries((t) =>
    chunks.map((userIds) =>
      t.identity.joinRequests.getJoinAdmissions(
        { organizationId, userIds },
        { enabled: enabled && invited.data !== undefined },
      ),
    ),
  );
  // useQueries answers a new array every render; the data changes only with a chunk or an answer.
  const answeredAt = pages.map((page) => page.dataUpdatedAt).join(",");
  const answered = pages.every((page) => page.data !== undefined);
  const data = useMemo(
    () =>
      invited.data && answered
        ? memberProvenanceFor({
            userIds: invited.data.memberUserIds,
            invitedUserIds: invited.data.invitedUserIds,
            admissions: pages.flatMap((page) => page.data ?? []),
          })
        : undefined,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on what the answers are
    [invited.data, chunks, answered, answeredAt],
  );
  const failed = pages.find((page) => page.isError);

  return {
    data,
    isLoading: invited.isLoading || pages.some((page) => page.isLoading),
    isError: invited.isError || failed !== undefined,
    error: invited.error ?? failed?.error ?? null,
    refetch: () => Promise.all([invited.refetch(), ...pages.map((page) => page.refetch())]),
  };
}
