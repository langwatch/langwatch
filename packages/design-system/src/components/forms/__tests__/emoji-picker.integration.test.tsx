// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { EmojiPicker } from "../emoji-picker.tsx";

afterEach(cleanup);

describe("EmojiPicker", () => {
  describe("when an emoji is picked from the grid", () => {
    /** @scenario "Picking an emoji from the grid sets the icon and closes the picker" */
    it("reports it and closes", async () => {
      const onChange = vi.fn();
      renderWithDesignSystem(<EmojiPicker value="🧩" onChange={onChange} />);

      await userEvent.click(screen.getByRole("button", { name: "Change icon" }));
      await userEvent.click(await screen.findByRole("button", { name: "🚀" }));

      expect(onChange).toHaveBeenCalledWith("🚀");
      await waitFor(() => expect(screen.queryByRole("button", { name: "🚀" })).toBeNull());
    });
  });

  describe("when an emoji is typed and Enter is pressed", () => {
    /** @scenario "Typing an emoji and pressing Enter sets the icon" */
    it("reports the typed emoji", async () => {
      const onChange = vi.fn();
      renderWithDesignSystem(<EmojiPicker value="🧩" onChange={onChange} />);

      await userEvent.click(screen.getByRole("button", { name: "Change icon" }));
      await userEvent.type(await screen.findByPlaceholderText("Or type an emoji"), "🦊{Enter}");

      expect(onChange).toHaveBeenCalledWith("🦊");
    });
  });
});
