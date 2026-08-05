/**
 * @vitest-environment jsdom
 *
 * The evaluations-v3 workbench's Run via API dialog shows copyable snippets that
 * trigger this experiment through the unified evaluations-v3 backend and read
 * the per-row results back. It offers a language picker (Python default, then
 * TypeScript, then Shell) and a data-source picker (attached dataset, inline
 * data, dataset id). The dialog is opened from the workbench "Run Options" menu,
 * so it is rendered controlled by its caller.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RunViaApiDialog } from "../RunViaApiButton";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDialog = () =>
  render(
    <RunViaApiDialog
      open={true}
      onOpenChange={() => {}}
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

const dialogText = () => screen.getByRole("dialog").textContent ?? "";

const click = async (label: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByText(label));
};

describe("RunViaApiDialog (evaluations-v3)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the dialog is open", () => {
    /** @scenario Python is the default language */
    it("defaults to a Python snippet that runs the experiment", async () => {
      renderDialog();

      await screen.findByRole("dialog");
      const snippet = dialogText();
      expect(snippet).toContain('langwatch.experiment.run("my-experiment"');
      // Python is the default tab and reads the results back.
      expect(snippet).toContain("result.results");
      expect(snippet).toContain("result.run_url");
    });

    /** @scenario The dialog shows how to read results back */
    it("shows reading the per-row results and the run url", async () => {
      renderDialog();

      await screen.findByRole("dialog");
      const snippet = dialogText();
      expect(snippet).toContain("result.results");
      expect(snippet).toContain("result.run_url");
    });
  });

  describe("when switching language", () => {
    /** @scenario The evaluations-v3 dialog targets the experiment run endpoint */
    it("shows a curl posting to the experiment run endpoint for Shell", async () => {
      renderDialog();

      await screen.findByRole("dialog");
      await click("Shell");
      const snippet = dialogText();
      expect(snippet).toContain("/api/experiments/my-experiment/run");
      // Shell starts the run, polls it, then fetches the results.
      expect(snippet).toContain("/api/experiments/runs/$RUN_ID/results");
    });

    it("shows the TypeScript SDK call reading rows and the run url", async () => {
      renderDialog();

      await screen.findByRole("dialog");
      await click("TypeScript");
      const snippet = dialogText();
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
      renderDialog();

      await screen.findByRole("dialog");
      // Attached dataset (default): constant parameters only.
      expect(dialogText()).toContain("parameters=");

      await click("Inline data");
      expect(dialogText()).toContain("data=[");

      await click("Dataset id");
      expect(dialogText()).toContain("dataset_id=");

      await click("Attached dataset");
      expect(dialogText()).toContain("parameters=");
    });
  });
});
