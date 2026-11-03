/**
 * A mapping to a column the dataset no longer has: the column header names it
 * and clears it in one click.
 * @see specs/experiments-v3/mapping-validation.feature
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/experiments-v3/use-latest-prompt-version.ts", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));
vi.mock("../../../../../behavior/experiments-v3/use-target-name.ts", () => ({
  useTargetName: () => "Support agent",
  useTargetNames: (targets: unknown[]) => targets.map(() => "Support agent"),
}));

import { useEvaluationsV3Store } from "../../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import type { TargetConfig } from "../../../../../model/experiments-v3/types.ts";
import { DEFAULT_TEST_DATA_ID } from "../../../../../model/experiments-v3/types.ts";
import { TargetHeader } from "../target-header.tsx";

const TARGET_ID = "connected-1";

const connectedTarget: TargetConfig = {
  id: TARGET_ID,
  type: "agent",
  agentType: "connected",
  inputs: [
    { identifier: "input", type: "str" },
    { identifier: "plan", type: "str", optional: true },
  ],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    [DEFAULT_TEST_DATA_ID]: {
      input: {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      },
      plan: {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "environment",
      },
    },
  },
};

/** The header of the target as the store holds it, so a cleared mapping re-renders. */
const StoreTargetHeader = () => {
  const target = useEvaluationsV3Store((state) => state.targets.find((t) => t.id === TARGET_ID));
  return target ? <TargetHeader target={target} onEdit={vi.fn()} /> : null;
};

beforeEach(() => {
  act(() => {
    const store = useEvaluationsV3Store.getState();
    store.reset();
    // The default dataset, saved before its "environment" column was deleted.
    store.updateDataset(DEFAULT_TEST_DATA_ID, {
      columns: [{ id: "input", name: "input", type: "string" }],
    });
    store.addTarget(connectedTarget);
  });
});

afterEach(() => {
  cleanup();
  act(() => useEvaluationsV3Store.getState().reset());
});

describe("given a saved workbench whose runner maps a field to a column the dataset lacks", () => {
  /** @scenario "The column header names a stale mapping and clears it in one click" */
  it("warns about the stale mapping and clears it from the runner menu", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<StoreTargetHeader />);

    await user.hover(screen.getByTestId("missing-mapping-alert"));
    expect(
      await screen.findByText('"plan" reads "environment", which is not in the dataset'),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("target-header-button"));
    await user.click(await screen.findByText("Remove mappings to missing columns"));

    const mappings = useEvaluationsV3Store.getState().targets.find((t) => t.id === TARGET_ID)
      ?.mappings[DEFAULT_TEST_DATA_ID];
    expect(mappings).not.toHaveProperty("plan");
    expect(mappings).toHaveProperty("input");
    await waitFor(() => {
      expect(screen.queryByTestId("missing-mapping-alert")).not.toBeInTheDocument();
    });
  });
});
