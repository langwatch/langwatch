/**
 * @vitest-environment jsdom
 * @see packages/design-system/specs/design-system-boundary.feature
 */
import { useChakraContext } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { uiDesignSystem } from "../../../behavior/design-system";
import { UiDesignSystemShell } from "../ui-design-system-shell";

// jsdom ships no matchMedia, and the colour-mode provider reads it on mount.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => cleanup());

/** Reads back the system every descendant of the shell actually styles against. */
function SystemProbe({ onSystem }: { onSystem: (system: unknown) => void }) {
  onSystem(useChakraContext());
  return null;
}

describe("UiDesignSystemShell", () => {
  describe("given the application has composed its installed feature theme extensions", () => {
    /** @scenario Every provider uses the composed system */
    it("styles its descendants against that composed system, not Chakra's default", () => {
      let seen: unknown = null;
      render(
        <UiDesignSystemShell system={uiDesignSystem}>
          <SystemProbe
            onSystem={(system) => {
              seen = system;
            }}
          />
        </UiDesignSystemShell>,
      );

      // Identity, not resemblance: a nested provider carrying Chakra's default
      // system would answer a different object here, and every token the
      // installed features added would silently stop resolving.
      expect(seen).toBe(uiDesignSystem);

      // ...and the composition really did fold the feature extension in: the
      // condition the Langy theme declares resolves to its own selector, which
      // it could not do on the base system alone.
      const css = (seen as { css(styles: object): Record<string, unknown> }).css({
        _langy: { color: "red" },
      });
      expect(Object.keys(css)).toContain(".langy-root &");
    });
  });
});
