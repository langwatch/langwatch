import { useState } from "react";
import { useDebounce } from "use-debounce";
import { api } from "~/utils/api";
import { BackofficeTable } from "../BackofficeTable";
import { InstanceDrawer } from "./instances/InstanceDrawer";
import { InstancesTable } from "./instances/InstancesTable";

const PAGE_SIZE = 25;

/**
 * Every self-hosted install that has reported (ADR-139, section 10), newest
 * activity first.
 *
 * LangWatch shipped self-hosted for three years with no record of who ran it.
 * This is that record: which company, which release, how far they got in
 * getting started and what they do with it, built from the daily usage report
 * and nothing else. Read only, because every number here was reported by an
 * install and an operator editing one would make the registry say something no
 * install ever said.
 */
export default function SelfHostedInstancesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = api.selfHostedInstances.getAll.useQuery({
    page,
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
          setPage(0);
        }}
        searchPlaceholder="Search by domain, hostname, release or instance id"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          // The bar counts from one, the query counts from zero.
          page: page + 1,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: (next) => setPage(next - 1),
        }}
      >
        <InstancesTable
          instances={list.data?.instances ?? []}
          isLoading={list.isLoading}
          onOpen={setOpenId}
        />
      </BackofficeTable>

      <InstanceDrawer instanceRowId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
