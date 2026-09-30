// The Access tab's read: one page of grants, narrowed by scope and status, paged by cursor.

import type { GrantScopeType, GrantStatus } from "@langwatch/authz-contract";
import { useState } from "react";

import { authzApi } from "./authz-api.ts";

const PAGE_SIZE = 50;

export function useGrantList({ organizationId }: { organizationId: string }) {
  const [scopeType, setScopeType] = useState<GrantScopeType | undefined>();
  const [status, setStatus] = useState<GrantStatus | undefined>();
  // The cursors of the pages before this one; the last is the page on screen.
  const [cursors, setCursors] = useState<string[]>([]);

  const page = authzApi.authz.listGrants.useQuery({
    organizationId,
    query: {
      limit: PAGE_SIZE,
      order: "newest",
      ...(scopeType ? { scopeType } : {}),
      ...(status ? { status } : {}),
      ...(cursors.length > 0 ? { cursor: cursors[cursors.length - 1] } : {}),
    },
  });
  const nextCursor = page.data?.nextCursor ?? null;

  return {
    scopeType,
    status,
    selectScopeType: (value: GrantScopeType | undefined) => {
      setScopeType(value);
      setCursors([]);
    },
    selectStatus: (value: GrantStatus | undefined) => {
      setStatus(value);
      setCursors([]);
    },
    grants: page.data?.grants ?? [],
    isLoading: page.isLoading,
    isError: page.isError,
    hasPrevious: cursors.length > 0,
    hasNext: !!nextCursor,
    isPaged: cursors.length > 0 || !!nextCursor,
    previousPage: () => setCursors(cursors.slice(0, -1)),
    nextPage: () => nextCursor && setCursors([...cursors, nextCursor]),
  };
}
