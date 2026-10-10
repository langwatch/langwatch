/**
 * The Access tab: every grant, gathered onto whoever holds it (main's RoleAssignmentsPanel),
 * each holder opening onto its grants to change or revoke. One read, folded in the browser.
 * specs/identity/org-access-cluster.feature, specs/rbac/roles-and-access-ui.feature
 */

import type { GrantScopeTier, GrantStatus } from "@langwatch/authz-contract";
import { FilterChips } from "@langwatch/design-system/filter-chips";
import {
  Button,
  Card,
  HStack,
  SkeletonText,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { useMemo, useState } from "react";

import { authzApi } from "../../behavior/authz-api.ts";
import { useGrantRevoke } from "../../behavior/use-grant-mutations.ts";
import { type GrantRow, grantRowOf } from "../../model/grants/grants.ts";
import { holdersOf, scopeCounts } from "../../model/role-holders.ts";
import { SectionErrorNotice } from "../elements/section-error-notice.tsx";
import { AccessGrantDialog } from "./access-grant-dialog.tsx";
import { GrantRoleButton } from "./grants/grant-role-button.tsx";
import { HolderRow } from "./grants/holder-row.tsx";
import { RevokeGrantDialog } from "./grants/revoke-grant-dialog.tsx";

type ScopeFilter = "ALL" | GrantScopeTier;
type StatusFilter = "ANY" | GrantStatus;

const SCOPE_FILTERS: readonly { label: string; value: ScopeFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Organization", value: "ORGANIZATION" },
  { label: "Teams", value: "TEAM" },
  { label: "Projects", value: "PROJECT" },
];

const STATUS_FILTERS: readonly { label: string; value: StatusFilter }[] = [
  { label: "Any status", value: "ANY" },
  { label: "Active", value: "active" },
  { label: "Expired", value: "expired" },
];

/** Holders on one page of the list. */
export const HOLDER_PAGE_SIZE = 50;

type OpenDialog = { kind: "none" } | { kind: "grant" } | { kind: "change"; grant: GrantRow };

export function AccessPanel({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const assignments = authzApi.authz.listManagedGrants.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const revoke = useGrantRevoke({ organizationId });
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ANY");
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "none" });
  const [grantToRevoke, setGrantToRevoke] = useState<GrantRow | null>(null);
  // Expiry is judged once per visit, as the server's own read judges it once per request.
  const [nowMs] = useState(() => nowInstant().epochMilliseconds);

  const rows = useMemo(() => assignments.data ?? [], [assignments.data]);
  // Counted across everything, not the filter: a chip must say what is behind it.
  const counts = useMemo(() => scopeCounts(rows), [rows]);
  const holders = useMemo(
    () =>
      holdersOf(
        rows.filter(
          (grant) =>
            (scopeFilter === "ALL" || grant.scopeType === scopeFilter) &&
            (statusFilter === "ANY" || grantRowOf({ grant, nowMs }).status === statusFilter),
        ),
      ),
    [rows, scopeFilter, statusFilter, nowMs],
  );
  const pageCount = Math.max(1, Math.ceil(holders.length / HOLDER_PAGE_SIZE));
  const shown = holders.slice(page * HOLDER_PAGE_SIZE, (page + 1) * HOLDER_PAGE_SIZE);

  if (assignments.isError) {
    return <SectionErrorNotice title="Couldn't load your role assignments" />;
  }

  return (
    <VStack align="start" gap={6} width="full">
      <HStack width="full" flexWrap="wrap" gap={4}>
        <FilterChips
          value={scopeFilter}
          onChange={(next) => {
            setScopeFilter(next as ScopeFilter);
            setPage(0);
          }}
          groupLabel="Filter role assignments by scope"
          countNoun={{ singular: "role assignment", plural: "role assignments" }}
          items={SCOPE_FILTERS.map((filter) => ({ ...filter, count: counts[filter.value] }))}
        />
        <FilterChips
          value={statusFilter}
          onChange={(next) => {
            setStatusFilter(next as StatusFilter);
            setPage(0);
          }}
          groupLabel="Filter role assignments by status"
          items={STATUS_FILTERS}
        />
        <Spacer />
        {assignments.data !== undefined && (
          <Text fontSize="sm" color="fg.muted">
            {holders.length} {holders.length === 1 ? "member or group" : "members and groups"}
          </Text>
        )}
        <GrantRoleButton canManage={canManage} onClick={() => setDialog({ kind: "grant" })} />
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0} overflowX="auto">
          {assignments.isLoading ? (
            <SkeletonText noOfLines={5} gap={4} padding={4} />
          ) : (
            <VStack gap={0} width="full" align="stretch" data-testid="role-assignments-list">
              {shown.length === 0 ? (
                <Text padding={6} textAlign="center" color="fg.muted">
                  Nobody has been assigned a role yet.
                </Text>
              ) : (
                shown.map((holder) => (
                  <HolderRow
                    key={holder.key}
                    holder={holder}
                    nowMs={nowMs}
                    canManage={canManage}
                    onChangeRole={(grant) => setDialog({ kind: "change", grant })}
                    onRevoke={setGrantToRevoke}
                  />
                ))
              )}
            </VStack>
          )}
        </Card.Body>
      </Card.Root>

      {pageCount > 1 && (
        <HStack width="full" justify="end">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </HStack>
      )}

      {dialog.kind !== "none" && (
        <AccessGrantDialog
          key={dialog.kind === "change" ? dialog.grant.id : "new"}
          organizationId={organizationId}
          editing={dialog.kind === "change" ? dialog.grant : null}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      <RevokeGrantDialog
        grant={grantToRevoke}
        loading={revoke.isRevoking}
        onCancel={() => setGrantToRevoke(null)}
        onConfirm={() => {
          if (!grantToRevoke) return;
          revoke.revoke({ grantId: grantToRevoke.id, onSettled: () => setGrantToRevoke(null) });
        }}
      />
    </VStack>
  );
}
