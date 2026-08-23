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
  return render(element, {
    wrapper: ({ children }) => (
      <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
    ),
    ...options,
  });
}
