import { Text, VStack } from "@chakra-ui/react";
import { Database } from "lucide-react";
import { DatasetSelector } from "~/components/datasets/DatasetSelector";
import { api } from "~/utils/api";
import type {
  ClientDef,
  ConfigFormProps,
  SavedTriggerRow,
  SummaryIdentity,
} from "../../types";
import type { DatasetActionParams } from "./shared";

interface DatasetMapping {
  mapping: Record<string, { source: string; key: string; subkey: string }>;
  expansions: string[];
}

export interface DatasetSlice {
  datasetId: string;
  mapping: DatasetMapping;
}

const EMPTY_MAPPING: DatasetMapping = { mapping: {}, expansions: [] };

function initialSlice(): DatasetSlice {
  return { datasetId: "", mapping: EMPTY_MAPPING };
}

function isComplete(slice: DatasetSlice): boolean {
  return slice.datasetId.length > 0;
}

function summary(slice: DatasetSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  return `${name} → dataset ${slice.datasetId || "(not chosen)"}`;
}

function fromTriggerRow(row: SavedTriggerRow): DatasetSlice {
  const params = (row.actionParams ?? {}) as Partial<DatasetActionParams> & {
    datasetMapping?: DatasetMapping;
  };
  return {
    datasetId: typeof params.datasetId === "string" ? params.datasetId : "",
    mapping:
      params.datasetMapping &&
      typeof params.datasetMapping === "object" &&
      "mapping" in params.datasetMapping
        ? params.datasetMapping
        : EMPTY_MAPPING,
  };
}

function toActionParams(slice: DatasetSlice): DatasetActionParams {
  return {
    datasetId: slice.datasetId,
    datasetMapping: slice.mapping,
  };
}

function DatasetConfigForm({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<DatasetSlice>) {
  const datasets = api.dataset.getAll.useQuery(
    { projectId: ctx.projectId },
    { enabled: !!ctx.projectId, refetchOnWindowFocus: false },
  );
  return (
    <VStack align="stretch" gap={3}>
      <DatasetSelector
        datasets={datasets.data}
        localStorageDatasetId={slice.datasetId}
        errors={{}}
        setValue={(_field: string, value: string) =>
          onChange({ ...slice, datasetId: value })
        }
        onCreateNew={() => {
          // noop
        }}
      />
      <Text color="fg.muted" textStyle="xs">
        Column mapping uses the dataset's defaults; refine after creating from
        the dataset view.
      </Text>
    </VStack>
  );
}

const client: ClientDef<DatasetSlice> = {
  Icon: Database,
  initialSlice,
  isComplete,
  summary,
  fromTriggerRow,
  toActionParams,
  ConfigForm: DatasetConfigForm,
};

export default client;
