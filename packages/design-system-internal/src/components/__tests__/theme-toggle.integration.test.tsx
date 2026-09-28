// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "../../theme.ts";
import { ThemeToggle } from "../theme-toggle.tsx";

const radio = ({ name }: { name: string }) => screen.getByRole("radio", { name });

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => cleanup());

  describe("when nothing is stored", () => {
    it("selects System", () => {
      render(<ThemeToggle />);

      expect(radio({ name: "System theme" }).matches(":checked")).toBe(true);
    });
  });

  describe("when Dark is chosen", () => {
    it("stores the choice and sets it on <html>", () => {
      render(<ThemeToggle />);

      fireEvent.click(radio({ name: "Dark theme" }));

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("comes back selected on the next mount", () => {
      const first = render(<ThemeToggle />);
      fireEvent.click(radio({ name: "Dark theme" }));
      first.unmount();

      render(<ThemeToggle />);

      expect(radio({ name: "Dark theme" }).matches(":checked")).toBe(true);
    });
  });

  describe("when System is chosen after Light", () => {
    it("removes data-theme so the media query decides", () => {
      render(<ThemeToggle />);

      fireEvent.click(radio({ name: "Light theme" }));
      fireEvent.click(radio({ name: "System theme" }));

      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    });
  });
});
