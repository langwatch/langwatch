import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";

const BLANK_WORKBENCH_DATASET_ID = "test-data";
const BLANK_WORKBENCH_NAME = "New Evaluation";

export const createBlankWorkbenchState = ({
  name,
}: { name?: string } = {}): PersistedEvaluationsV3State => {
  const columns = [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ];

  return {
    name: name ?? BLANK_WORKBENCH_NAME,
    datasets: [
      {
        id: BLANK_WORKBENCH_DATASET_ID,
        name: "Test Data",
        type: "inline",
        inline: { columns, records: { input: [], expected_output: [] } },
        columns,
      },
    ],
    activeDatasetId: BLANK_WORKBENCH_DATASET_ID,
    evaluators: [],
    targets: [],
  };
};
