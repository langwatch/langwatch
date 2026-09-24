/**
 * Run via API dialog: language and data-source pickers with copyable snippets.
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunViaApiDialog } from "../run-via-api-button.tsx";

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
    let snippet: string;

    beforeEach(async () => {
      renderDialog();

      await screen.findByRole("dialog");
      snippet = dialogText();
    });

    /** @scenario Python is the default language */
    it("defaults to a Python snippet that runs the experiment", () => {
      expect(snippet).toContain('langwatch.experiment.run("my-experiment"');
      // Python is the default tab and reads the results back.
      expect(snippet).toContain("result.results");
      expect(snippet).toContain("result.run_url");
    });

    /** @scenario The dialog shows how to read results back */
    it("shows reading the per-row results and the run url", () => {
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
      expect(snippet).toContain('langwatch.experiments.runWithResults("my-experiment"');
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
