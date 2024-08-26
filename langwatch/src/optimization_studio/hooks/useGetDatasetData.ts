import { nanoid } from "nanoid";
import { useMemo } from "react";
import type { DatasetRecordEntry } from "../../server/datasets/types";
import type { Entry } from "../types/dsl";
import {
  transposeIDlessColumnsFirstToRowsFirstWithId,
  transpostRowsFirstToColumnsFirstWithoutId,
} from "../utils/datasetUtils";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { datasetDatabaseRecordsToInMemoryDataset } from "../../components/datasets/DatasetTable";

export const useGetDatasetData = (
  dataset: Entry["dataset"],
  preview = false
) => {
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

  const data_: Record<string, string[]> | undefined = dataset?.id
    ? databaseDataset_
      ? transpostRowsFirstToColumnsFirstWithoutId(
          databaseDataset_.datasetRecords
        )
      : undefined
    : dataset?.inline
    ? dataset.inline
    : undefined;

  const columns = useMemo(() => {
    const columns = Object.keys(data_ ?? {}).filter((key) => key !== "id");
    if (preview && columns.length > 4) {
      return new Set(columns.slice(0, 4));
    }

    return new Set(columns);
  }, [data_, preview]);

  const rows: DatasetRecordEntry[] | undefined = useMemo(() => {
    const rows = data_
      ? transposeIDlessColumnsFirstToRowsFirstWithId(data_).slice(
          0,
          preview ? 5 : undefined
        )
      : undefined;

    return rows?.map((row) => {
      const row_ = Object.fromEntries(
        Object.entries(row).filter(([key]) => key === "id" || columns.has(key))
      );
      if (!row_.id) {
        row_.id = nanoid();
      }

      return row_;
    }) as DatasetRecordEntry[];
  }, [columns, data_, preview]);

  return {
    rows,
    columns: Array.from(columns),
  };
};
