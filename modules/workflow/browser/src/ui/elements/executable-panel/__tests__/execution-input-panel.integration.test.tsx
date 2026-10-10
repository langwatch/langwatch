/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExecutionInputPanel } from "../execution-input-panel.tsx";

describe("ExecutionInputPanel", () => {
  describe("when the user edits input before running", () => {
    it("keeps edits across equivalent field updates and submits them", async () => {
      const user = userEvent.setup();
      const execute = vi.fn();
      const { rerender } = renderWithDesignSystem(
        <ExecutionInputPanel
          fields={[{ identifier: "input", type: "str", value: "seed" }]}
          onExecute={execute}
        />,
      );
      await user.clear(screen.getByRole("textbox"));
      await user.type(screen.getByRole("textbox"), "row input");
      rerender(
        <ExecutionInputPanel
          fields={[{ identifier: "input", type: "str", value: "seed" }]}
          onExecute={execute}
        />,
      );
      expect(screen.getByRole("textbox")).toHaveValue("row input");
      await user.click(screen.getByRole("button", { name: "Execute" }));
      await waitFor(() => expect(execute).toHaveBeenCalledWith({ input: "row input" }));
      rerender(
        <ExecutionInputPanel
          fields={[{ identifier: "input", type: "str", value: "updated upstream" }]}
          onExecute={execute}
        />,
      );
      await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("updated upstream"));
    });
  });
});
