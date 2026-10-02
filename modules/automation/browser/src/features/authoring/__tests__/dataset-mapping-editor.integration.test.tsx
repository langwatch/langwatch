/**
 * @vitest-environment jsdom
 * The "Add to dataset" step edits which trace field fills each column with trace's lent mapping
 * editor, stood in here: it starts from the slice's mapping and writes only the user's edits back.
 */
import "@testing-library/jest-dom/vitest";
import type { UiEvaluatorTracesMappingProps } from "@langwatch/browser-host/declarations";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigFormCtx } from "../../../model/provider-types.ts";

const editor = vi.hoisted(() => {
  const state: { props?: UiEvaluatorTracesMappingProps } = {};
  return state;
});

vi.mock("../../../behavior/lent-peers.tsx", () => ({
  TracesMapping: (props: UiEvaluatorTracesMappingProps) => {
    editor.props = props;
    // Like the real editor, report the derived mapping on opening, in a different key order.
    const reported = useRef(false);
    useEffect(() => {
      if (reported.current) return;
      reported.current = true;
      props.setTraceMapping?.({
        mapping: Object.fromEntries(Object.entries(props.traceMapping?.mapping ?? {}).reverse()),
        expansions: [],
      });
    }, [props]);
    return (
      <button
        type="button"
        onClick={() =>
          props.setTraceMapping?.({
            mapping: { ...props.traceMapping?.mapping, plan: { source: "input" } },
            expansions: [],
          })
        }
      >
        Map plan to input
      </button>
    );
  },
}));

vi.mock("../../../behavior/automation-api.ts", () => ({
  api: {},
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
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

const { fakeAutomationHost, renderWithAutomationHost } = await import("../../../testing.tsx");
const { default: client, deriveMappingFromColumns } =
  await import("../ui/sections/dataset.client.tsx");

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
  const ConfigForm = client.ConfigForm;
  renderWithAutomationHost(
    <ConfigForm
      slice={{ datasetId: "dataset-1", mapping: savedMapping }}
      onChange={onChange}
      ctx={ctx}
    />,
    { host: fakeAutomationHost() },
  );
  return onChange;
};

describe("the Add to dataset delivery step", () => {
  afterEach(() => {
    cleanup();
    editor.props = undefined;
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

    /** @scenario "The dataset delivery step edits the column mapping it saves" */
    it("names the columns still filled from the same-named metadata key", () => {
      renderForm();

      expect(screen.getByTestId("metadata-fallback")).toHaveTextContent(
        "Filled from the trace metadata key with the same name: plan.",
      );
    });

    it("does not save anything merely by opening the editor", () => {
      const onChange = renderForm();

      expect(onChange).not.toHaveBeenCalled();
    });

    it("no longer claims the dataset view can refine the mapping", () => {
      renderForm();

      expect(screen.queryByText(/from the dataset view/)).toBeNull();
    });
  });
});
