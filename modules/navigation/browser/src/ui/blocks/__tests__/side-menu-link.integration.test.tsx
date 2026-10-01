/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/product-sidebars.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { LuSettings } from "react-icons/lu";
import { afterEach, describe, expect, it } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { SideMenuLink } from "../side-menu-link.tsx";

/** Every stylesheet rule the page holds, as the text the browser parsed. */
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

/** The hover rules written for any of the element's generated classes. */
function hoverRulesFor({ element }: { element: HTMLElement }): string[] {
  const classes = Array.from(element.classList);
  return injectedCss()
    .split("}")
    .filter((rule) => rule.includes("hover") && classes.some((name) => rule.includes(`.${name}`)));
}

afterEach(() => {
  cleanup();
});

describe("a sidebar entry", () => {
  describe("when the pointer rests on it", () => {
    /** @scenario A sidebar entry underlines under the pointer */
    it("underlines, as the link recipe's plain variant does", () => {
      renderWithDesignSystem(
        <WithStubNavigationHost>
          <SideMenuLink icon={<LuSettings />} label="Members" href="/settings/members" />
        </WithStubNavigationHost>,
      );

      const entry = screen.getByRole("link", { name: "Members" });
      expect(entry).toHaveAttribute("href", "/settings/members");
      expect(hoverRulesFor({ element: entry }).join("}")).toMatch(/text-decoration:\s*underline/);
    });
  });
});
