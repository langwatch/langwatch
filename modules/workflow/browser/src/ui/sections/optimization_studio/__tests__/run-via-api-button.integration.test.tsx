/**
 * @vitest-environment jsdom
 * Run via API button opens a dialog with copyable snippets (Python default,
 * TypeScript, Go, Shell) for triggering this workflow via evaluations-v3.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { RunViaApiButton } from "../run-via-api-button.tsx";

const openDialog = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("run-via-api"));
  return screen.findByRole("dialog");
};

const switchLanguage = async (label: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByText(label));
};

const switchDataSource = async (label: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByText(label));
};

describe("RunViaApiButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the button is clicked", () => {
    /** @scenario The run-via-API dialog shows a copyable snippet for this workflow */
    it("opens a dialog defaulting to a Python snippet that runs this workflow", async () => {
      renderWithDesignSystem(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[{ identifier: "input", type: "str" }]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
      );

      const dialog = await openDialog();
      expect(dialog).toHaveTextContent("Run via API");
      const snippet = dialog.textContent ?? "";
      // Python is the default language and runs the workflow via the SDK.
      expect(snippet).toContain('langwatch.workflow.run("workflow_abc123"');
      expect(snippet).toContain("result.results");
      expect(snippet).toContain("attached dataset");
    });

    describe("when the Shell language is selected", () => {
      /** @scenario The run-via-API dialog shows a copyable snippet for this workflow */
      it("shows a curl snippet posting to this workflow's evaluate endpoint", async () => {
        renderWithDesignSystem(
          <RunViaApiButton
            workflowId="workflow_abc123"
            entryFields={[{ identifier: "input", type: "str" }]}
            datasetColumns={["input"]}
            datasetName="My Dataset"
          />,
        );

        await openDialog();
        await switchLanguage("Shell");
        const dialog = screen.getByRole("dialog");
        const snippet = dialog.textContent ?? "";
        expect(snippet).toContain("/api/workflows/workflow_abc123/evaluate");
        expect(snippet).toContain("X-Auth-Token");
        expect(snippet).toContain('"parameters"');
      });
    });

    describe("when the Go language is selected", () => {
      /** @scenario The run-via-API dialog shows a copyable snippet for this workflow */
      it("shows a net/http snippet posting to this workflow's evaluate endpoint", async () => {
        renderWithDesignSystem(
          <RunViaApiButton
            workflowId="workflow_abc123"
            entryFields={[{ identifier: "input", type: "str" }]}
            datasetColumns={["input"]}
            datasetName="My Dataset"
          />,
        );

        await openDialog();
        await switchLanguage("Go");
        const dialog = screen.getByRole("dialog");
        const snippet = dialog.textContent ?? "";
        expect(snippet).toContain("/api/workflows/workflow_abc123/evaluate");
        expect(snippet).toContain('"parameters"');
        // The Go snippet uses bearer auth, never the legacy header.
        expect(snippet).toContain("Bearer ");
        expect(snippet).not.toContain("X-Auth-Token");
      });
    });
  });

  describe("when the entry point has a field the dataset does not provide", () => {
    /** @scenario The parameters example mirrors the entry point fields the dataset does not provide */
    it("maps that field into the parameters and omits the dataset-backed ones", async () => {
      renderWithDesignSystem(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[
            { identifier: "input", type: "str" },
            { identifier: "feature_flag", type: "str" },
          ]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
      );

      const dialog = await openDialog();
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain("feature_flag");
      expect(snippet).not.toContain('"input"');
    });
  });

  describe("when the entry point has an image field the dataset does not provide", () => {
    /** @scenario An image entry field gets a base64 data-url example */
    it("shows a base64 data-url example for the image field", async () => {
      renderWithDesignSystem(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[{ identifier: "screenshot", type: "image" }]}
          datasetColumns={[]}
        />,
      );

      const dialog = await openDialog();
      // The inline source surfaces the image field's base64 example.
      await switchDataSource("Inline data");
      expect(dialog.textContent ?? "").toContain("data:image/png;base64,");
    });
  });

  describe("when the dataset already provides every entry field", () => {
    /** @scenario With every entry field already provided by the dataset the snippet shows an illustrative flag */
    it("falls back to an illustrative feature-flag example", async () => {
      renderWithDesignSystem(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[{ identifier: "input", type: "str" }]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
      );

      const dialog = await openDialog();
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain("variant-b");
    });
  });

  describe("when switching between data sources", () => {
    it("updates the snippet body for inline data and dataset id", async () => {
      renderWithDesignSystem(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[
            { identifier: "input", type: "str" },
            { identifier: "feature_flag", type: "str" },
          ]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
      );

      await openDialog();
      await switchDataSource("Inline data");
      expect(screen.getByRole("dialog").textContent ?? "").toContain("data=[");

      await switchDataSource("Dataset id");
      expect(screen.getByRole("dialog").textContent ?? "").toContain("dataset_id=");
    });
  });
});
