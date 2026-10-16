import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { SearchX } from "lucide-react";
import { useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { keepPreviousData } from "../../../../model/keep-previous-data.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import type { License } from "../../model/license-terms.ts";
import { LicensesTable } from "../blocks/licenses-table.tsx";
import { ActivationCodesSection } from "./activation-codes-section.tsx";
import { AdminTable } from "./admin-table-shell.tsx";
import { LicenseDetailDrawer } from "./license-detail-drawer.tsx";
import { LicenseIssueDrawer } from "./license-issue-drawer.tsx";
import { LicenseRevokeDialog } from "./license-revoke-dialog.tsx";

const PAGE_SIZE = 25;

type StatusFilter = "active" | "inactive" | "all";
type AudienceFilter = "customer" | "internal" | "all";

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
  const filtered = status !== "all" || audience !== "all";

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
                setStatus(value as StatusFilter);
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
                setAudience(value as AudienceFilter);
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
          isLoading={list.isLoading}
          onOpen={setOpenId}
          onRevoke={setRevoking}
          onResetBinding={(license) => commands.resetInstanceBinding.mutate({ id: license.id })}
          emptyState={
            filtered || debouncedSearch ? (
              <NoDataInfoBlock
                size="inline"
                icon={<SearchX />}
                title="No licenses match."
                description={
                  filtered
                    ? "The filters above hide every license that matches; the number on each choice says what it would show."
                    : "Nothing in the registry matches the search."
                }
                primaryAction={
                  filtered ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setStatus("all");
                        setAudience("all");
                        setPage(1);
                      }}
                    >
                      Show every license
                    </Button>
                  ) : undefined
                }
              />
            ) : undefined
          }
        />
      </AdminTable>

      <ActivationCodesSection />

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
