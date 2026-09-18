/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoModelsConfiguredCallout } from "../no-models-configured-callout.tsx";

function withProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>
    </QueryClientProvider>
  );
}

describe("NoModelsConfiguredCallout", () => {
  afterEach(() => cleanup());

  it("renders the standalone callout with a clickable row that opens settings in a new tab", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(withProviders(<NoModelsConfiguredCallout />));
    const callout = screen.getByTestId("no-models-configured-callout");
    expect(callout).toBeInTheDocument();
    expect(screen.getByText(/No models configured/i)).toBeInTheDocument();
    expect(screen.getByTestId("no-models-configured-cta")).toBeInTheDocument();
    // Whole row is clickable (rchaves: 'clicking anywhere should take
    // them to setup'). Rendered as a div with role=link rather than an
    // anchor — the app's global anchor styles fragmented the rounded
    // border. Clicking calls window.open with the target URL.
    expect(callout.getAttribute("role")).toBe("link");
    callout.click();
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/settings\/model-providers/),
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("includes the surface-specific label when forFeatureLabel is provided", () => {
    render(withProviders(<NoModelsConfiguredCallout forFeatureLabel="evaluators" />));
    expect(screen.getByText(/No models configured for evaluators/i)).toBeInTheDocument();
  });
});
