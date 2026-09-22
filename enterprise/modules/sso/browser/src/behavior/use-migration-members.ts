// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The cutover's members, paged. The setup read already carries the first
 * page, so the only state a screen keeps is which cursor the reader moved to
 * — and going back is that cursor cleared, not a second read.
 */
import { useState } from "react";

import type { MigrationMembersView } from "../model/migration-route.ts";
import { ssoApi } from "./sso-api.ts";

/** What one press of "next members" asks for, as the read's own default. */
const MEMBERS_PER_PAGE = 25;

export interface MigrationMembersPaging {
  members: MigrationMembersView;
  membersLoading: boolean;
  membersFailed: boolean;
  /** The cutover the reader was paging through is no longer answered. */
  membersUnavailable: boolean;
  showPreviousMembers: boolean;
  onNextMembers: (cursor: string) => void;
  onPreviousMembers: () => void;
  onRetryMembers: () => void;
}

export function useMigrationMembers({
  organizationId,
  connectionId,
  firstPage,
}: {
  organizationId: string;
  connectionId: string;
  /** What `getSetup` already answered, which is the page nobody re-reads. */
  firstPage: MigrationMembersView;
}): MigrationMembersPaging {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = ssoApi.ssoSetup.getMigrationProgress.useQuery(
    { organizationId, connectionId, cursor, limit: MEMBERS_PER_PAGE },
    { enabled: cursor !== null },
  );
  const paging = cursor !== null;
  const answered = paging ? page.data : void 0;

  return {
    members: answered?.members ?? firstPage,
    membersLoading: paging && page.isLoading,
    membersFailed: paging && page.isError,
    // A read that answered "no cutover" while somebody is paging through one
    // is not an empty page: the pair closed underneath them.
    membersUnavailable: paging && !page.isLoading && !page.isError && answered === null,
    showPreviousMembers: paging,
    onNextMembers: (next: string) => setCursor(next),
    onPreviousMembers: () => setCursor(null),
    onRetryMembers: () => {
      void page.refetch();
    },
  };
}
