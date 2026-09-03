import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useChakraContext } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { createDesignSystem } from "@langwatch/design-system/system";
import { UiDesignSystemShell } from "../src/ui/sections/ui-design-system-shell";

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
});

describe("UiDesignSystemShell", () => {
  it("provides the injected design system to Chakra consumers", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const system = createDesignSystem();

    await act(() => {
      root?.render(
        <UiDesignSystemShell system={system} forcedTheme="light">
          <ChakraSystemProbe expectedSystem={system} />
        </UiDesignSystemShell>,
      );
    });

    expect(container.querySelector("[data-testid='chakra-system']")?.textContent).toBe(
      "injected/light",
    );
  });
});

function ChakraSystemProbe({
  expectedSystem,
}: {
  expectedSystem: ReturnType<typeof createDesignSystem>;
}) {
  const system = useChakraContext();
  const { colorMode } = useColorMode();

  const systemSource = system === expectedSystem ? "injected" : "default";

  return <output data-testid="chakra-system">{`${systemSource}/${colorMode}`}</output>;
}
