// @vitest-environment jsdom
/**
 * Drawers share the opaque overlay ground with menus and dialogs.
 * @see specs/features/drawer-backdrop-transparency-blur.feature
 */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

/**
 * Chakra applies these props through an Emotion-injected class, not an inline
 * style, so the assertion reads the injected rules for this element's OWN
 * classes — reading every `<style>` tag would stay green on an unrelated rule.
 */
function cssRulesForElement(element: Element): string {
  const allCss = Array.from(document.querySelectorAll("style"))
    .map((style) => style.innerHTML)
    .join("\n");
  return Array.from(element.classList)
    .flatMap((className) => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return Array.from(allCss.matchAll(new RegExp(`\\.${escaped}\\{([^}]*)\\}`, "g"))).map(
        (match) => match[1] ?? "",
      );
    })
    .join("\n");
}

function openDrawerContent(): HTMLElement {
  renderWithDesignSystem(
    <Drawer.Root open={true} placement="end">
      <Drawer.Content>
        <Drawer.Body>Content</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
  );
  const content = document.querySelector<HTMLElement>("[data-part='content']");
  if (!content) throw new Error("drawer content panel not found");
  return content;
}

describe("Drawer.Content", () => {
  afterEach(cleanup);

  describe("when a drawer opens", () => {
    /** @scenario "Drawer content panel shares the opaque overlay surface" */
    it("uses the overlay token without mixing the page behind it", () => {
      const css = cssRulesForElement(openDrawerContent());

      expect(css).toContain("background:var(--chakra-colors-bg-overlay)");
      expect(css).not.toContain("backdrop-filter");
      expect(css).not.toContain("--lw-panel-alpha");
    });
  });
});
