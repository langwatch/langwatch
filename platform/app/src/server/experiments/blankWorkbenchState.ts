import type { PersistedEvaluationsV3State } from "../../experiments-v3/types/persistence";

/**
 * The blank workbench a REST `POST /api/experiments` creates when the caller
 * sends no state.
 *
 * The workbench itself starts from `createInitialState()` in
 * `~/experiments-v3/types`, which is browser code: it carries sample rows,
 * Sets and other UI-only fields, and importing it here would pull a client
 * module into every backend process. This is the same setup written as the
 * persisted shape the service stores: one inline dataset with the input /
 * expected_output column pair, no rows, no targets and no evaluators.
 *
 * `__tests__/blankWorkbenchState.unit.test.ts` pins the two together, so a
 * change to the client default that this misses fails there.
 */
export const BLANK_WORKBENCH_DATASET_ID = "test-data";

export const BLANK_WORKBENCH_NAME = "New Evaluation";

export const createBlankWorkbenchState = ({
  name,
}: {
  name?: string;
} = {}): PersistedEvaluationsV3State => {
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
        inline: {
          columns,
          records: { input: [], expected_output: [] },
        },
        columns,
      },
    ],
    activeDatasetId: BLANK_WORKBENCH_DATASET_ID,
    evaluators: [],
    targets: [],
  };
};
