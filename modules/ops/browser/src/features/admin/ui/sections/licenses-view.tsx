import { HStack, Text } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { keepPreviousData } from "../../../../model/keep-previous-data.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import type { License, LicenseCounts } from "../../model/license-terms.ts";
import { LicensesTable, type LicensesEmpty } from "../blocks/licenses-table.tsx";
import { ActivationCodesSection } from "./activation-codes-section.tsx";
import { AdminTable } from "./admin-table-shell.tsx";
import { LicenseDetailDrawer } from "./license-detail-drawer.tsx";
import { LicenseIssueDrawer } from "./license-issue-drawer.tsx";
import { LicenseRevokeDialog } from "./license-revoke-dialog.tsx";
import { SelfHostedNoticesSection } from "./self-hosted-notices-section.tsx";

const PAGE_SIZE = 25;

const STATUS_FILTERS = ["active", "inactive", "all"] as const;
const AUDIENCE_FILTERS = ["customer", "internal", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
type AudienceFilter = (typeof AUDIENCE_FILTERS)[number];

/**
 * Cloud admin's license registry (ADR-156). Every write is a verb with
 * the operator recorded on it; a signed license is shown exactly once.
 */
export default function LicensesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<License | null>(null);
  // Opens on what an operator acts on: customers' licenses still in force.
  const [status, setStatus] = useState<StatusFilter>("active");
  const [audience, setAudience] = useState<AudienceFilter>("customer");
  const commands = useLicenseCommands();

  const list = api.licenseRegistry.getAll.useQuery(
    {
      // PaginationBar counts from 1; the route from 0.
      page: page - 1,
      pageSize: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      audience: audience === "all" ? undefined : audience,
    },
    // Keeps the counts on screen while a new filter loads, so the controls don't jump.
    { placeholderData: keepPreviousData },
  );
  const counts = list.data?.counts;
  const showEverything = () => {
    setStatus("all");
    setAudience("all");
    setPage(1);
  };

  return (
    <>
      <AdminTable
        title="Licenses"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search by customer, email or license id"
        filters={
          <HStack gap={3} wrap="wrap">
            <SegmentedControl
              size="sm"
              aria-label="License status"
              value={status}
              onValueChange={({ value }) => {
                const picked = oneOf(STATUS_FILTERS, value);
                if (!picked) return;
                setStatus(picked);
                setPage(1);
              }}
              items={[
                { value: "active", label: <Counted text="Active" count={counts?.active} /> },
                {
                  value: "inactive",
                  label: <Counted text="Revoked or expired" count={counts?.inactive} />,
                },
                {
                  value: "all",
                  label: (
                    <Counted text="Any status" count={sum(counts?.active, counts?.inactive)} />
                  ),
                },
              ]}
            />
            <SegmentedControl
              size="sm"
              aria-label="Who the license is for"
              value={audience}
              onValueChange={({ value }) => {
                const picked = oneOf(AUDIENCE_FILTERS, value);
                if (!picked) return;
                setAudience(picked);
                setPage(1);
              }}
              items={[
                { value: "customer", label: <Counted text="Customers" count={counts?.customer} /> },
                {
                  value: "internal",
                  label: <Counted text="Internal tests" count={counts?.internal} />,
                },
                {
                  value: "all",
                  label: (
                    <Counted text="Everyone" count={sum(counts?.customer, counts?.internal)} />
                  ),
                },
              ]}
            />
          </HStack>
        }
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        onCreate={() => setCreating(true)}
        createLabel="New license"
      >
        <LicensesTable
          licenses={list.data?.licenses ?? []}
          // Rows kept from the previous query are no reason to say the list is empty.
          isLoading={list.isLoading || list.isPlaceholderData}
          onOpen={setOpenId}
          onRevoke={setRevoking}
          onResetBinding={(license) => commands.resetInstanceBinding.mutate({ id: license.id })}
          empty={emptyOf({
            counts,
            searching: debouncedSearch !== "",
            onClearSearch: () => {
              setSearch("");
              showEverything();
            },
            onShowEverything: showEverything,
          })}
        />
      </AdminTable>

      <ActivationCodesSection />

      <SelfHostedNoticesSection />

      <LicenseDetailDrawer
        licenseId={openId}
        onClose={() => setOpenId(null)}
        onRevoke={(license) => setRevoking(license)}
      />
      <LicenseIssueDrawer open={creating} onClose={() => setCreating(false)} />
      <LicenseRevokeDialog license={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}

/** A filter choice with how many licenses choosing it lists, once that is known. */
function Counted({ text, count }: { text: string; count: number | undefined }) {
  return (
    <HStack as="span" gap={1.5}>
      <Text as="span">{text}</Text>
      {count !== undefined && (
        <Text as="span" color="fg.muted" fontVariantNumeric="tabular-nums">
          {count}
        </Text>
      )}
    </HStack>
  );
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined || right === undefined ? undefined : left + right;
}

/**
 * Why the list is empty, so it never blames the filters for what the search did:
 * with nothing matching the search at all, it is the search; otherwise the filters.
 */
function emptyOf({
  counts,
  searching,
  onClearSearch,
  onShowEverything,
}: {
  counts: LicenseCounts | undefined;
  searching: boolean;
  onClearSearch: () => void;
  onShowEverything: () => void;
}): LicensesEmpty | undefined {
  if (!counts) return undefined;
  if (counts.all === 0) {
    return searching
      ? {
          state: "no-results",
          title: "No licenses match the search",
          description: "Nothing in the registry matches it, whichever filters are chosen.",
          onClearFilters: onClearSearch,
        }
      : undefined;
  }
  return {
    state: "no-results",
    title: "No licenses match these filters",
    description: `${counts.all} ${counts.all === 1 ? "license matches" : "licenses match"} other choices; the number on each says how many it shows.`,
    onClearFilters: onShowEverything,
  };
}

function oneOf<T extends string>(choices: readonly T[], value: string | null): T | undefined {
  return choices.find((choice) => choice === value);
}
