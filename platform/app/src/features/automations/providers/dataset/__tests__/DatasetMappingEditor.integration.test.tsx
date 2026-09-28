/**
 * @vitest-environment jsdom
 *
 * The "Add to dataset" delivery step edits which trace field fills each
 * column, with the traces view's own mapping editor, and saves it with the
 * automation. The editor itself is stood in: what is under test is that it
 * starts from the slice's mapping and writes its answer back to the slice.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MappingState } from "~/server/tracer/tracesMapping";
import type { ConfigFormCtx } from "../../types";

const editor = vi.hoisted(() => ({
  props: null as null | {
    targetFields: string[];
    traceMapping?: MappingState;
    setTraceMapping?: (mapping: MappingState) => void;
  },
}));

vi.mock("~/components/traces/TracesMapping", () => ({
  TracesMapping: (props: NonNullable<typeof editor.props>) => {
    editor.props = props;
    return (
      <button
        type="button"
        onClick={() =>
          props.setTraceMapping?.({
            mapping: {
              ...props.traceMapping?.mapping,
              plan: { source: "input" },
            },
            expansions: [],
          })
        }
      >
        Map plan to input
      </button>
    );
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "dataset-1",
              name: "Support traces",
              columnTypes: [
                { name: "input", type: "string" },
                { name: "plan", type: "string" },
              ],
            },
          ],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), goBack: vi.fn() }),
}));

const { default: client, deriveMappingFromColumns } = await import("../client");
const ConfigForm = client.ConfigForm;

const ctx: ConfigFormCtx = {
  projectId: "project-1",
  organizationId: "org-1",
  teamSlug: "team",
  variables: [],
  example: {},
  cadenceMode: "immediate",
  notificationCadence: "immediate",
  setNotificationCadence: () => undefined,
  hasEvaluationFilter: false,
  sourceKind: "trace",
};

const savedMapping = deriveMappingFromColumns([
  { name: "input", type: "string" },
  { name: "plan", type: "string" },
]);

const renderForm = () => {
  const onChange = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <ConfigForm
        slice={{ datasetId: "dataset-1", mapping: savedMapping }}
        onChange={onChange}
        ctx={ctx}
      />
    </ChakraProvider>,
  );
  return onChange;
};

describe("the Add to dataset delivery step", () => {
  afterEach(() => {
    cleanup();
    editor.props = null;
  });

  describe("given an automation that already writes to a dataset", () => {
    /** @scenario "The dataset delivery step edits the column mapping it saves" */
    it("opens the mapping editor on the dataset's columns and the saved mapping", () => {
      renderForm();

      expect(editor.props?.targetFields).toEqual(["input", "plan"]);
      expect(editor.props?.traceMapping?.mapping).toEqual({
        input: { source: "input", key: "", subkey: "" },
        plan: { source: "metadata", key: "plan", subkey: "" },
      });
    });

    /** @scenario "The dataset delivery step edits the column mapping it saves" */
    it("names the columns still filled from the same-named metadata key", () => {
      renderForm();

      expect(screen.getByTestId("metadata-fallback")).toHaveTextContent(
        "Filled from the trace metadata key with the same name: plan.",
      );
    });

    /** @scenario "The dataset delivery step edits the column mapping it saves" */
    it("saves an edited mapping on the automation", () => {
      const onChange = renderForm();

      fireEvent.click(screen.getByText("Map plan to input"));

      expect(onChange).toHaveBeenCalledWith({
        datasetId: "dataset-1",
        mapping: {
          mapping: expect.objectContaining({ plan: { source: "input" } }),
          expansions: [],
        },
      });
    });

    it("no longer claims the dataset view can refine the mapping", () => {
      renderForm();

      expect(screen.queryByText(/from the dataset view/)).toBeNull();
    });
  });
});
