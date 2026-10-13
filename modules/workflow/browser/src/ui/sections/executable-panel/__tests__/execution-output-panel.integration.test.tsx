/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionOutputPanel } from "../execution-output-panel.tsx";

const privacy = vi.hoisted(() => ({ isRedacted: false }));
vi.mock("../../../../behavior/use-field-redaction.ts", () => ({
  useFieldRedaction: () => ({ isRedacted: privacy.isRedacted, isLoading: false, visibleTo: null }),
}));
vi.mock("../../../../model/workflow-host.ts", () => ({
  useWorkflowHost: () => ({ hasPermission: () => false }),
}));
vi.mock("../../../../behavior/lent-trace.tsx", () => ({
  RenderInputOutput: ({ value }: { value: unknown }) => <span>{String(value)}</span>,
}));

describe("ExecutionOutputPanel", () => {
  beforeEach(() => {
    privacy.isRedacted = false;
  });

  describe("given a failed code execution", () => {
    /** @scenario "Run failures show a readable alert and copyable details" */
    it("shows the exception, highlights the full traceback and copies it", async () => {
      const user = userEvent.setup();
      const traceback =
        'Traceback (most recent call last):\n  File "node.py", line 4\nValueError: boom row refused';
      const { container } = renderWithDesignSystem(
        <ExecutionOutputPanel executionState={{ status: "error", error: traceback }} />,
      );
      expect(within(screen.getByRole("alert")).getByText("ValueError")).toBeInTheDocument();
      expect(within(screen.getByRole("alert")).getByText("boom row refused")).toBeInTheDocument();
      await waitFor(() => expect(container.querySelector("pre .line")).not.toBeNull());
      expect(container.querySelector("pre")?.textContent).toContain(traceback);
      await user.click(screen.getByRole("button", { name: "Copy code" }));
      expect(await navigator.clipboard.readText()).toBe(traceback);
    });

    it("extracts the type and message from JSON while preserving its details", async () => {
      const error = { type: "ValueError", message: "Invalid row", traceback: ["line 3", "line 8"] };
      const { container } = renderWithDesignSystem(
        <ExecutionOutputPanel executionState={{ status: "error", error: JSON.stringify(error) }} />,
      );
      expect(within(screen.getByRole("alert")).getByText("ValueError")).toBeInTheDocument();
      expect(within(screen.getByRole("alert")).getByText("Invalid row")).toBeInTheDocument();
      await waitFor(() => expect(container.querySelector("pre .line")).not.toBeNull());
      expect(container.querySelector("pre")?.textContent).toBe(JSON.stringify(error, null, 2));
    });
  });

  describe("given successful structured output", () => {
    /** @scenario "Structured output preserves all JSON values" */
    it.each([false, true])("highlights and copies JSON, serialized=%s", async (serialized) => {
      const user = userEvent.setup();
      const value = { rows: [{ accepted: true, count: 0, note: null }], text: "a".repeat(300) };
      const { container } = renderWithDesignSystem(
        <ExecutionOutputPanel
          executionState={{
            status: "success",
            outputs: { result: serialized ? JSON.stringify(value) : value },
          }}
        />,
      );
      await waitFor(() => expect(container.querySelector("pre .line")).not.toBeNull());
      expect(container.querySelector("pre")?.textContent).toBe(JSON.stringify(value, null, 2));
      await user.click(screen.getByRole("button", { name: "Copy code" }));
      expect(await navigator.clipboard.readText()).toBe(JSON.stringify(value, null, 2));
    });
  });

  describe("given private output", () => {
    /** @scenario "Privacy restrictions hide error details and copying" */
    it("hides the failure message and its copy action", () => {
      privacy.isRedacted = true;
      renderWithDesignSystem(
        <ExecutionOutputPanel
          executionState={{ status: "error", error: "ValueError: private row" }}
        />,
      );
      expect(screen.getByText("Redacted")).toBeInTheDocument();
      expect(screen.queryByText(/private row/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
