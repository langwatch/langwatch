import { useChakraContext } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uiDesignSystem } from "../src/behavior/design-system";
import { createUiOuterProvider } from "../src/ui/sections/ui-outer-providers";

let installedSystem: unknown;

function DesignSystemProbe() {
  installedSystem = useChakraContext();
  return <div data-testid="routed-content">LangWatch</div>;
}

let root: Root | undefined;

function marker(name: string) {
  return function Marker({ children }: { children: ReactNode }) {
    return <div data-testid={name}>{children}</div>;
  };
}

beforeEach(() => {
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
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
});

describe("given the providers that wrap the router", () => {
  describe("when the application installs the ones it still owns", () => {
    it("nests attribution, session, transport, design system and graphics quality in that order", async () => {
      const OuterProvider = createUiOuterProvider({
        attribution: marker("attribution"),
        session: marker("session"),
        transport: marker("transport"),
        graphicsQuality: marker("graphics-quality"),
      });
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(() => {
        root?.render(
          <OuterProvider>
            <DesignSystemProbe />
          </OuterProvider>,
        );
      });

      const nesting = container.querySelector(
        "[data-testid='attribution'] [data-testid='session'] [data-testid='transport'] [data-testid='graphics-quality'] [data-testid='routed-content']",
      );

      expect(nesting?.textContent).toBe("LangWatch");
    });

    it("installs the package's own design system between transport and the page", async () => {
      const OuterProvider = createUiOuterProvider({
        attribution: marker("attribution"),
        session: marker("session"),
        transport: marker("transport"),
        graphicsQuality: marker("graphics-quality"),
      });
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(() => {
        root?.render(
          <OuterProvider>
            <DesignSystemProbe />
          </OuterProvider>,
        );
      });

      expect(installedSystem).toBe(uiDesignSystem);
    });
  });
});
