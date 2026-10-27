// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { List, ListItem } from "../list.tsx";

afterEach(() => cleanup());

describe("<ListItem/>", () => {
  describe("when a linked row is current", () => {
    it("marks the link aria-current page", () => {
      render(
        <List>
          <ListItem href="/a" title="Open one" current />
          <ListItem href="/b" title="Other" />
        </List>,
      );

      expect(screen.getByRole("link", { name: "Open one" }).getAttribute("aria-current")).toBe(
        "page",
      );
      expect(screen.getByRole("link", { name: "Other" }).hasAttribute("aria-current")).toBe(false);
    });
  });

  describe("when a linked row takes onSelect", () => {
    it("selects in place on a plain click", () => {
      const onSelect = vi.fn();
      render(<ListItem href="/a" title="Welcome" onSelect={onSelect} />);

      const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Welcome" }));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(notPrevented).toBe(false);
    });

    it("leaves a modified click to the link", () => {
      const onSelect = vi.fn();
      render(<ListItem href="/a" title="Welcome" onSelect={onSelect} />);

      const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Welcome" }), {
        metaKey: true,
      });

      expect(onSelect).not.toHaveBeenCalled();
      expect(notPrevented).toBe(true);
    });
  });

  describe("when a row takes onSelect without a link", () => {
    it("is a button selected by click and by keyboard", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<ListItem title="Welcome" onSelect={onSelect} current />);

      const row = screen.getByRole("button", { name: "Welcome" });
      await user.click(row);
      await user.keyboard("{Enter}");
      await user.keyboard(" ");

      expect(row.getAttribute("aria-current")).toBe("true");
      expect(document.activeElement).toBe(row);
      expect(onSelect).toHaveBeenCalledTimes(3);
    });
  });
});
