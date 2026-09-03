import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { DesignSystemProvider } from "../provider";

export function renderWithDesignSystem(
  element: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
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
  }
  if (typeof window !== "undefined" && !window.ResizeObserver) {
    // Overlays position themselves through floating-ui, which observes the
    // trigger's box. jsdom ships no ResizeObserver, and the missing global
    // surfaces as an unhandled rejection from an animation frame rather than
    // as a test failure, so the shard fails with its own summary all green.
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
  return render(element, {
    wrapper: ({ children }) => (
      <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
    ),
    ...options,
  });
}
