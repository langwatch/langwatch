/**
 * @vitest-environment node
 *
 * Server-rendered contract for the color-mode visibility CSS. The aura stays
 * in one hydration-safe tree and Chakra emits the dark selector alongside the
 * light-mode display rule.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeOfDayAura } from "../TimeOfDayAura";

describe("TimeOfDayAura color-mode visibility", () => {
  const renderAura = () =>
    renderToString(
      <ChakraProvider value={defaultSystem}>
        <TimeOfDayAura timeOfDay="evening" />
      </ChakraProvider>,
    );

  /** @scenario Light mode hides the time-of-day aura */
  it("emits a hidden light-mode base rule", () => {
    expect(renderAura()).toContain("display:none");
  });

  /** @scenario Dark mode keeps the time-of-day aura */
  it("emits a visible dark-mode override", () => {
    const html = renderAura();
    expect(html).toContain(".dark");
    expect(html).toContain("display:block");
  });
});
