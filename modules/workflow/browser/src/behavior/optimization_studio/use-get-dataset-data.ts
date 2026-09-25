import type { WorkflowApiRouter, RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import { api } from "@langwatch/browser-trpc/workflow-api";
import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { datasetDatabaseRecordsToInMemoryDataset } from "@langwatch/workflow-browser-kit";
import type { Entry } from "@langwatch/workflow-contract";
import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-contract";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import { useMemo } from "react";

import { useOrganizationTeamProject } from "../studio-host/use-organization-team-project.ts";

type DatasetView = { records: DatasetRecordEntry[]; columnTypes: DatasetColumns };

/** ADR-032 I-READY: a still-preparing or failed dataset reads as "no rows yet", never retried. */
function retryUnlessPreparing(failureCount: number, error: unknown): boolean {
  if ((error as { data?: { code?: string } })?.data?.code === "PRECONDITION_FAILED") {
    return false;
  }
  return failureCount < 3;
}

/** The stored dataset once loaded, or the workflow's inline one; a preview shows 5 columns. */
function datasetView(input: {
  datasetId: string | undefined;
  inline: NonNullable<Entry["dataset"]>["inline"];
  loaded: ReturnType<typeof datasetDatabaseRecordsToInMemoryDataset> | undefined;
  preview: boolean;
}): DatasetView | undefined {
  if (input.datasetId) {
    return input.loaded
      ? {
          records: input.loaded.datasetRecords,
          columnTypes: input.loaded.columnTypes.slice(0, input.preview ? 5 : undefined),
        }
      : undefined;
  }

  if (input.inline) {
    return {
      records: transposeColumnsFirstToRowsFirstWithId(input.inline.records),
      columnTypes: input.inline.columnTypes,
    };
  }

  return undefined;
}

/** The rows a preview shows (the first 5), keeping only the id and the visible columns. */
function visibleRows(input: {
  data: DatasetView | undefined;
  preview: boolean;
  columnSet: Set<string>;
}): DatasetRecordEntry[] | undefined {
  const rows = input.data ? input.data.records.slice(0, input.preview ? 5 : undefined) : undefined;

  return rows?.map((row) => {
    const row_ = Object.fromEntries(
      Object.entries(row).filter(([key]) => key === "id" || input.columnSet.has(key)),
    );

    return row_;
  }) as DatasetRecordEntry[];
}

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
    RouterOutputs["datasetRecord"]["getHead"],
    TRPCClientErrorLike<WorkflowApiRouter>
  >;
  total: number | undefined;
} => {
  const { project } = useOrganizationTeamProject();
  const databaseDataset = api.datasetRecord.getHead.useQuery(
    { projectId: project?.id ?? "", datasetId: dataset?.id ?? "" },
    {
      enabled: !!project && !!dataset?.id && dataset?.id !== "",
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      staleTime: 1000 * 60 * 60,
      // ADR-032 I-READY: a still-preparing/failed dataset read throws
      // PRECONDITION_FAILED. Don't retry that — treat it as "no rows yet" (the
      // hook returns `rows ?? []` below) instead of hammering the server.
      retry: retryUnlessPreparing,
      trpc: {
        context: {
          skipBatch: true,
        },
      },
    },
  );
  const databaseDataset_ =
    databaseDataset.data?.dataset && "datasetRecords" in databaseDataset.data.dataset
      ? datasetDatabaseRecordsToInMemoryDataset(databaseDataset.data.dataset)
      : undefined;

  const data: { records: DatasetRecordEntry[]; columnTypes: DatasetColumns } | undefined = useMemo(
    () =>
      datasetView({
        datasetId: dataset?.id,
        inline: dataset?.inline,
        loaded: databaseDataset_,
        preview,
      }),
    [dataset?.id, dataset?.inline, databaseDataset_, preview],
  );

  const columnSet = useMemo(() => {
    return new Set(data?.columnTypes.map((col) => col.name));
  }, [data?.columnTypes]);

  const rows: DatasetRecordEntry[] | undefined = useMemo(
    () => visibleRows({ data, preview, columnSet }),
    [data, preview, columnSet],
  );

  return {
    rows: rows ?? [],
    columns: data?.columnTypes ?? [],
    query: databaseDataset,
    total: dataset?.inline?.records
      ? (Object.values(dataset?.inline.records)[0]?.length ?? 0)
      : databaseDataset.data?.total,
  };
};
