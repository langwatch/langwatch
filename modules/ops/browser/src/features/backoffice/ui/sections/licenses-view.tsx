import { useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import type { License } from "../../model/license-terms.ts";
import { LicensesTable } from "../blocks/licenses-table.tsx";
import { ActivationCodesSection } from "./activation-codes-section.tsx";
import { BackofficeTable } from "./backoffice-table-shell.tsx";
import { LicenseDetailDrawer } from "./license-detail-drawer.tsx";
import { LicenseIssueDrawer } from "./license-issue-drawer.tsx";
import { LicenseRevokeDialog } from "./license-revoke-dialog.tsx";

const PAGE_SIZE = 25;

/**
 * The backoffice's license registry (ADR-156). Every write is a verb with
 * the operator recorded on it; a signed license is shown exactly once.
 */
export default function LicensesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<License | null>(null);
  const commands = useLicenseCommands();

  const list = api.licenseRegistry.getAll.useQuery({
    // PaginationBar counts from 1; the route from 0.
    page: page - 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });

  return (
    <>
      <BackofficeTable
        title="Licenses"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search by customer, email or license id"
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
        />
      </BackofficeTable>

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
