import { useChakraContext } from "@chakra-ui/react";
import { createUiOuterProvider } from "@langwatch/ui-kernel/outer-providers";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uiDesignSystem } from "../../design-system";

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
  act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
});

describe("given the providers that wrap the router", () => {
  describe("when the application installs the ones it still owns", () => {
    let container: HTMLDivElement;

    beforeEach(async () => {
      const OuterProvider = createUiOuterProvider({
        attribution: marker("attribution"),
        session: marker("session"),
        transport: marker("transport"),
        graphicsQuality: marker("graphics-quality"),
        designSystem: uiDesignSystem,
      });
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <OuterProvider>
            <DesignSystemProbe />
          </OuterProvider>,
        );
      });
    });

    it("nests attribution, session, transport, design system and graphics quality in that order", () => {
      const nesting = container.querySelector(
        "[data-testid='attribution'] [data-testid='session'] [data-testid='transport'] [data-testid='graphics-quality'] [data-testid='routed-content']",
      );

      expect(nesting?.textContent).toBe("LangWatch");
    });

    it("installs the package's own design system between transport and the page", () => {
      expect(installedSystem).toBe(uiDesignSystem);
    });
  });
});
