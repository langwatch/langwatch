import { useState } from "react";
import { useDebounce } from "use-debounce";
import { api } from "~/utils/api";
import { BackofficeTable } from "../BackofficeTable";
import { IssueDrawer } from "./licenses/IssueDrawer";
import { LicenseDrawer } from "./licenses/LicenseDrawer";
import { LicensesTable } from "./licenses/LicensesTable";
import { RevokeDialog } from "./licenses/RevokeDialog";
import type { License } from "./licenses/types";

const PAGE_SIZE = 25;

/**
 * The backoffice's license registry (ADR-139): every license LangWatch issued,
 * with its customer, term, status, entitlements and commercial terms.
 *
 * Every write here is a verb with the operator recorded on it: issue, register
 * an existing license, revoke, reissue, reset the instance binding, edit the
 * terms, link to a customer. A signed license is shown exactly once, when it is
 * issued or reissued, and never read back.
 */
export default function LicensesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<License | null>(null);

  const list = api.licenseRegistry.getAll.useQuery({
    page,
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
          setPage(0);
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
        />
      </BackofficeTable>

      <LicenseDrawer
        licenseId={openId}
        onClose={() => setOpenId(null)}
        onRevoke={(license) => setRevoking(license)}
      />
      <IssueDrawer open={creating} onClose={() => setCreating(false)} />
      <RevokeDialog license={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}
