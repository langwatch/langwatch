// @vitest-environment jsdom
/**
 * The drawer content panel is the surface a customer keeps their bearings
 * through: it is blurred and partly transparent so the page behind it stays
 * readable as context. Both values are routed through CSS variables, whose
 * defaults are the contract — a hardcoded value here would silently opt every
 * drawer in the product out of reduced-graphics mode.
 *
 * @see specs/features/drawer-backdrop-transparency-blur.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Drawer } from "../src/components/drawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
  render(
    <Drawer.Root open={true} placement="end">
      <Drawer.Content>
        <Drawer.Body>Content</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
    { wrapper: Wrapper },
  );
  const content = document.querySelector<HTMLElement>("[data-part='content']");
  if (!content) throw new Error("drawer content panel not found");
  return content;
}

describe("Drawer.Content", () => {
  afterEach(cleanup);

  describe("when a drawer opens", () => {
    /** @scenario "Drawer content panel applies blur filter and transparency" */
    it("blurs its backdrop by 25px and fills at 80% opacity", () => {
      const css = cssRulesForElement(openDrawerContent());

      expect(css).toContain("var(--lw-backdrop-blur, blur(25px))");
      expect(css).toContain("var(--lw-panel-alpha, 80%)");
    });
  });
});
