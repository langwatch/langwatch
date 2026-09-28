/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
    render(withProviders(<NoModelsConfiguredCallout />));
    const callout = screen.getByTestId("no-models-configured-callout");
    expect(callout).toBeInTheDocument();
    expect(screen.getByText(/No models configured/i)).toBeInTheDocument();
    expect(screen.getByTestId("no-models-configured-cta")).toBeInTheDocument();
    // Whole row is clickable (rchaves: 'clicking anywhere should take
    // them to setup'): the row is itself the link to settings, in a new tab.
    expect(callout.tagName).toBe("A");
    expect(callout).toHaveAttribute("href", "/settings/model-providers");
    expect(callout).toHaveAttribute("target", "_blank");
    expect(callout).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("includes the surface-specific label when forFeatureLabel is provided", () => {
    render(withProviders(<NoModelsConfiguredCallout forFeatureLabel="evaluators" />));
    expect(screen.getByText(/No models configured for evaluators/i)).toBeInTheDocument();
  });
});
