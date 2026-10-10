// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TopBar } from "../top-bar.tsx";

afterEach(() => cleanup());

describe("<TopBar/>", () => {
  describe("when the links fit", () => {
    it("marks the current console and fades no edge", () => {
      render(
        <TopBar
          name="Mail"
          links={[
            { label: "Home", href: "/home" },
            { label: "Mail", href: "/", current: true },
          ]}
        />,
      );

      const scroller = screen.getByRole("link", { name: "Mail" }).parentElement;
      expect(screen.getByRole("link", { name: "Mail" }).getAttribute("aria-current")).toBe("page");
      expect(scroller?.hasAttribute("data-more-start")).toBe(false);
      expect(scroller?.hasAttribute("data-more-end")).toBe(false);
    });
  });

  describe("when links carry a group", () => {
    it("puts them in that group's menu, its trigger naming the current one", () => {
      render(
        <TopBar
          name="Voice simulator"
          links={[
            { label: "Home", href: "/home" },
            { label: "Mail", href: "/mail", group: "Sims" },
            { label: "Voice", href: "/voice", current: true, group: "Sims" },
            { label: "Mail room", href: "/mail-room", group: "Tools" },
          ]}
        />,
      );

      const nav = within(screen.getByRole("navigation", { name: "Consoles" }));
      expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual(["Home"]);
      expect(nav.getByRole("button", { name: "Sims · Voice" })).toBeTruthy();
      expect(nav.getByRole("button", { name: "Tools" })).toBeTruthy();
      fireEvent.click(nav.getByRole("button", { name: "Sims · Voice" }));
      const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual(["Mail", "Voice"]);
    });
  });
});
