/**
 * The setup a create call gets when it sends none.
 *
 * A caller that posts nothing still gets a workbench they can open, so the
 * create endpoint is usable on its own rather than only as step one of a
 * create-then-save pair.
 */
import type { PersistedEvaluationsV3State } from "@langwatch/experiment-contract";

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
