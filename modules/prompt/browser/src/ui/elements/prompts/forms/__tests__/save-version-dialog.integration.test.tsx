/**
 * @vitest-environment jsdom
 * The save-version dialog stays mounted between saves (WEB-5030).
 * @see modules/prompt/specs/prompt.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveVersionDialog } from "../save-version-dialog.tsx";

describe("given the save-version dialog", () => {
  afterEach(() => cleanup());

  describe("when a second version is saved from the same dialog", () => {
    /** @scenario "A second version saved from the same dialog keeps its description" */
    it("sends the second description too", async () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      renderWithDesignSystem(
        <SaveVersionDialog isOpen onClose={() => {}} onSubmit={onSubmit} nextVersion={2} />,
      );
      const message = await screen.findByTestId("prompt-save-version-message");
      const submit = screen.getByTestId("prompt-save-version-submit");

      await userEvent.type(message, "first change");
      await userEvent.click(submit);
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

      await userEvent.type(message, "second change");
      await userEvent.click(submit);

      await waitFor(() =>
        expect(onSubmit).toHaveBeenLastCalledWith({
          commitMessage: "second change",
          saveNewVersion: true,
        }),
      );
    });
  });
});
