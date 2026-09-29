// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

      const nav = screen.getByRole("navigation", { name: "Consoles" });
      expect(screen.getByRole("link", { name: "Mail" }).getAttribute("aria-current")).toBe("page");
      expect(nav.hasAttribute("data-more-start")).toBe(false);
      expect(nav.hasAttribute("data-more-end")).toBe(false);
    });
  });
});
