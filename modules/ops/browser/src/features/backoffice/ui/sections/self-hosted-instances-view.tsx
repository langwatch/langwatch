import { useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { InstancesTable } from "../blocks/instances-table.tsx";
import { BackofficeTable } from "./backoffice-table-shell.tsx";
import { InstanceDetailDrawer } from "./instance-detail-drawer.tsx";

const PAGE_SIZE = 25;

/** Every self-hosted install that has reported (ADR-156 §10), newest
 * activity first. Read only: an install reported every number here. */
export default function SelfHostedInstancesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = api.selfHostedInstances.getAll.useQuery({
    // PaginationBar counts from 1; the route from 0.
    page: page - 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });

  return (
    <>
      <BackofficeTable
        title="Self-hosted installs"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search by domain, hostname, release or instance id"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
      >
        <InstancesTable
          instances={list.data?.instances ?? []}
          isLoading={list.isLoading}
          onOpen={setOpenId}
        />
      </BackofficeTable>

      <InstanceDetailDrawer instanceRowId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
