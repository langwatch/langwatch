/**
 * @vitest-environment jsdom
 *
 * The evaluations-v3 workbench's Run via API button opens a dialog with
 * copyable snippets that trigger this experiment through the unified
 * evaluations-v3 backend and read the per-row results back. It offers a
 * language picker (Python default, then TypeScript, then Shell) and a
 * data-source picker (attached dataset, inline data, dataset id).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RunViaApiButton } from "../RunViaApiButton";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderButton = () =>
  render(
    <RunViaApiButton
      experimentSlug="my-experiment"
      entryFields={[
        { identifier: "question", type: "str" },
        { identifier: "feature_flag", type: "str" },
      ]}
      datasetColumns={["question"]}
      datasetName="My Dataset"
      projectSlug="my-project"
    />,
    { wrapper: Wrapper },
  );

const openDialog = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("run-via-api-experiment"));
  return screen.findByRole("dialog");
};

const click = async (label: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByText(label));
};

describe("RunViaApiButton (evaluations-v3)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the dialog is opened", () => {
    /** @scenario Python is the default language */
    it("defaults to a Python snippet that runs the experiment", async () => {
      renderButton();

      const dialog = await openDialog();
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain('langwatch.experiment.run("my-experiment"');
      // Python is the default tab and reads the results back.
      expect(snippet).toContain("result.results");
      expect(snippet).toContain("result.run_url");
    });

    /** @scenario The dialog shows how to read results back */
    it("shows reading the per-row results and the run url", async () => {
      renderButton();

      const dialog = await openDialog();
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain("result.results");
      expect(snippet).toContain("result.run_url");
    });
  });

  describe("when switching language", () => {
    /** @scenario The evaluations-v3 dialog targets the experiment run endpoint */
    it("shows a curl posting to the experiment run endpoint for Shell", async () => {
      renderButton();

      await openDialog();
      await click("Shell");
      const snippet = screen.getByRole("dialog").textContent ?? "";
      expect(snippet).toContain("/api/experiments/my-experiment/run");
      // Shell starts the run, polls it, then fetches the results.
      expect(snippet).toContain("/api/experiments/runs/$RUN_ID/results");
    });

    it("shows the TypeScript SDK call reading rows and the run url", async () => {
      renderButton();

      await openDialog();
      await click("TypeScript");
      const snippet = screen.getByRole("dialog").textContent ?? "";
      expect(snippet).toContain(
        'langwatch.experiments.runWithResults("my-experiment"',
      );
      expect(snippet).toContain("res.rows");
      expect(snippet).toContain("res.runUrl");
    });
  });

  describe("when switching data source", () => {
    /** @scenario The data-source choice changes the snippet body */
    it("changes the snippet body across attached, inline, and dataset id", async () => {
      renderButton();

      const dialog = await openDialog();
      // Attached dataset (default): constant parameters only.
      expect(dialog.textContent ?? "").toContain("parameters=");

      await click("Inline data");
      expect(screen.getByRole("dialog").textContent ?? "").toContain("data=[");

      await click("Dataset id");
      expect(screen.getByRole("dialog").textContent ?? "").toContain(
        "dataset_id=",
      );

      await click("Attached dataset");
      expect(screen.getByRole("dialog").textContent ?? "").toContain(
        "parameters=",
      );
    });
  });
});
