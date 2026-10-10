/**
 * @vitest-environment jsdom
 * The handle dialog refills itself on open, then must still read what is typed (WEB-5030).
 * @see modules/prompt/specs/prompt.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { PromptScope } from "@langwatch/prompt-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/use-prompt-handle-check.ts", () => ({
  usePromptHandleCheck: () => ({ checkHandleUniqueness: () => Promise.resolve(true) }),
}));

import { ChangeHandleDialog } from "../change-handle-dialog.tsx";

describe("given the change-handle dialog for an existing prompt", () => {
  afterEach(() => cleanup());

  describe("when a new handle is typed and saved", () => {
    /** @scenario "A prompt handle typed in the change-handle dialog is the one saved" */
    it("saves the typed handle, not the one it opened with", async () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      renderWithDesignSystem(
        <ChangeHandleDialog
          currentHandle="old-handle"
          currentScope={PromptScope.PROJECT}
          isOpen
          onClose={() => {}}
          onSubmit={onSubmit}
        />,
      );
      const input = await screen.findByTestId("prompt-handle-input");

      await userEvent.clear(input);
      await userEvent.type(input, "new-handle");
      await userEvent.click(screen.getByTestId("prompt-handle-submit"));

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith({ handle: "new-handle", scope: PromptScope.PROJECT }),
      );
    });
  });
});
