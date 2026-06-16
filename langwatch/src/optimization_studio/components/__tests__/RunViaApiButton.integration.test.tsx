/**
 * @vitest-environment jsdom
 *
 * The evaluations panel's Run via API button opens a dialog with a copyable
 * snippet for the workflow evaluate endpoint. The snippet's parameters example
 * mirrors the entry point's own fields, so it is real for this workflow.
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

const openDialog = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("run-via-api"));
  return screen.findByRole("dialog");
};

describe("RunViaApiButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the button is clicked", () => {
    /** @scenario The run-via-API dialog shows a copyable snippet for this workflow */
    it("opens a dialog with the curl snippet for this workflow's evaluate endpoint", async () => {
      render(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[{ identifier: "input", type: "str" }]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
        { wrapper: Wrapper },
      );

      const dialog = await openDialog();
      expect(dialog).toHaveTextContent("Run via API");
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain("/api/workflows/workflow_abc123/evaluate");
      expect(snippet).toContain("X-Auth-Token");
      expect(snippet).toContain('"parameters"');
      expect(snippet).toContain("attached dataset");
    });
  });

  describe("when the entry point has a field the dataset does not provide", () => {
    /** @scenario The parameters example mirrors the entry point fields the dataset does not provide */
    it("maps that field into the parameters and omits the dataset-backed ones", async () => {
      render(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[
            { identifier: "input", type: "str" },
            { identifier: "feature_flag", type: "str" },
          ]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
        { wrapper: Wrapper },
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
      render(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[{ identifier: "screenshot", type: "image" }]}
          datasetColumns={[]}
        />,
        { wrapper: Wrapper },
      );

      const dialog = await openDialog();
      expect(dialog.textContent ?? "").toContain("data:image/png;base64,");
    });
  });

  describe("when the dataset already provides every entry field", () => {
    /** @scenario With every entry field already provided by the dataset the snippet shows an illustrative flag */
    it("falls back to an illustrative feature-flag example with an explanatory comment", async () => {
      render(
        <RunViaApiButton
          workflowId="workflow_abc123"
          entryFields={[{ identifier: "input", type: "str" }]}
          datasetColumns={["input"]}
          datasetName="My Dataset"
        />,
        { wrapper: Wrapper },
      );

      const dialog = await openDialog();
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain("variant-b");
      expect(snippet).toContain("constant entry inputs");
    });
  });
});
