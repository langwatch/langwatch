import { useMemo } from "react";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import type { Entry } from "../types/dsl";
import { transposeIDlessColumnsFirstToRowsFirstWithId } from "../utils/datasetUtils";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { datasetDatabaseRecordsToInMemoryDataset } from "../../components/datasets/DatasetTable";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/api/root";

export const useGetDatasetData = ({
  dataset,
  preview = false,
}: {
  dataset: Entry["dataset"];
  preview?: boolean;
}): {
  rows: DatasetRecordEntry[];
  columns: DatasetColumns;
  query: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["datasetRecord"]["getHead"],
    TRPCClientErrorLike<AppRouter>
  >;
} => {
  const { project } = useOrganizationTeamProject();
  const databaseDataset = api.datasetRecord.getHead.useQuery(
    { projectId: project?.id ?? "", datasetId: dataset?.id ?? "" },
    {
      enabled: !!project && !!dataset?.id,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      staleTime: 1000 * 60 * 60,
    }
  );
  const databaseDataset_ = databaseDataset.data
    ? datasetDatabaseRecordsToInMemoryDataset(databaseDataset.data)
    : undefined;

  const data:
    | { records: DatasetRecordEntry[]; columnTypes: DatasetColumns }
    | undefined = useMemo(() => {
    if (dataset?.id) {
      return databaseDataset_
        ? {
            records: databaseDataset_.datasetRecords,
            columnTypes: databaseDataset_.columnTypes.slice(
              0,
              preview ? 5 : undefined
            ),
          }
        : undefined;
    }

    if (dataset?.inline) {
      return {
        records: transposeIDlessColumnsFirstToRowsFirstWithId(
          dataset.inline.records
        ),
        columnTypes: dataset.inline.columnTypes,
      };
    }

    return undefined;
  }, [dataset?.id, dataset?.inline, databaseDataset_, preview]);

  const columnSet = useMemo(() => {
    return new Set(data?.columnTypes.map((col) => col.name));
  }, [data?.columnTypes]);

  const rows: DatasetRecordEntry[] | undefined = useMemo(() => {
    const rows = data
      ? data.records.slice(0, preview ? 5 : undefined)
      : undefined;

    return rows?.map((row) => {
      const row_ = Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => key === "id" || columnSet.has(key)
        )
      );

      return row_;
    }) as DatasetRecordEntry[];
  }, [data, preview, columnSet]);

  return {
    rows,
    columns: data?.columnTypes ?? [],
    query: databaseDataset,
  };
};
