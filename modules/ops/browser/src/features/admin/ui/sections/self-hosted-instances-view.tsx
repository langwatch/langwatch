import { HandledErrorAlert } from "@langwatch/error-views";
import { useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router.ts";
import type { SelfHostedInstanceFilters } from "../../model/self-hosted-instance.ts";
import { InstancesSummary } from "../blocks/instances-summary.tsx";
import { InstancesTable } from "../blocks/instances-table.tsx";
import { InstanceFilters } from "../elements/instance-filters.tsx";
import { AdminTable } from "./admin-table-shell.tsx";
import { InstanceDetailDrawer } from "./instance-detail-drawer.tsx";

const PAGE_SIZE = 25;

/** Every self-hosted install that has reported (ADR-156 §10), with what they add up to on top.
 * Read only. The open drawer is `?instance=<row id>`, the link a diagnostics Slack message carries. */
export default function SelfHostedInstancesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<SelfHostedInstanceFilters>({ sort: "last_report" });
  const router = useRouter();
  const openId = typeof router.query.instance === "string" ? router.query.instance : null;
  const setOpenId = (instanceRowId: string | null) => {
    const query = { ...router.query } as Record<string, unknown>;
    if (instanceRowId) query.instance = instanceRowId;
    else delete query.instance;
    router.replace({ query }, { shallow: true });
  };

  const summary = api.selfHostedInstances.summary.useQuery();
  const list = api.selfHostedInstances.getAll.useQuery({
    // PaginationBar counts from 1; the route from 0.
    page: page - 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    ...filters,
  });

  const narrow = (next: SelfHostedInstanceFilters) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <>
      <AdminTable
        title="Self-hosted installs"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search by domain, hostname, release or instance id"
        summary={
          summary.error ? (
            <HandledErrorAlert error={summary.error} fallbackTitle="Couldn't load the summary" />
          ) : (
            <InstancesSummary
              summary={summary.data}
              activeSignal={filters.signal}
              onSignal={(signal) => narrow({ ...filters, signal })}
              onOpen={setOpenId}
            />
          )
        }
        filters={<InstanceFilters value={filters} onChange={narrow} />}
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
      </AdminTable>

      <InstanceDetailDrawer instanceRowId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
