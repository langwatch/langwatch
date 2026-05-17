/**
 * @vitest-environment jsdom
 *
 * Integration tests for the ModelSelector empty-state contract:
 * when the project has zero enabled providers, the picker swaps for a
 * NoModelsConfiguredCallout instead of rendering the System fallback
 * model id as if it were a real selection.
 *
 * Covers both the standalone callout (used by callers that drive their
 * own selection options directly) and the ModelSelector primitive
 * (which mounts the callout itself).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSelector } from "../ModelSelector";
import { NoModelsConfiguredCallout } from "../NoModelsConfiguredCallout";

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

// tRPC's getAllForProject query returns an empty providers map to
// simulate a freshly created project with zero configured providers.
vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
    },
  },
}));

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

  it("renders the standalone callout with a settings deeplink that opens in a new tab", () => {
    render(withProviders(<NoModelsConfiguredCallout />));
    const callout = screen.getByTestId("no-models-configured-callout");
    expect(callout).toBeInTheDocument();
    expect(screen.getByText(/No models configured/i)).toBeInTheDocument();
    expect(screen.getByTestId("no-models-configured-cta")).toBeInTheDocument();
    // The whole callout is the anchor (rchaves: 'clicking anywhere
    // should take them to setup'), not the inner button.
    expect(callout.tagName).toBe("A");
    expect(callout.getAttribute("href")).toMatch(
      /\/settings\/model-providers/,
    );
    expect(callout.getAttribute("target")).toBe("_blank");
  });

  it("includes the surface-specific label when forFeatureLabel is provided", () => {
    render(
      withProviders(
        <NoModelsConfiguredCallout forFeatureLabel="evaluators" />,
      ),
    );
    expect(
      screen.getByText(/No models configured for evaluators/i),
    ).toBeInTheDocument();
  });
});

describe("<ModelSelector /> empty state", () => {
  afterEach(() => cleanup());

  /** @scenario Empty picker renders a configure CTA instead of the System fallback model id */
  it("renders the NoModelsConfiguredCallout when no enabled providers are available", () => {
    render(
      withProviders(
        <ModelSelector
          model="openai/gpt-5.2"
          options={["openai/gpt-5.2", "openai/gpt-4o-mini"]}
          onChange={() => undefined}
          forFeatureLabel="AI search"
        />,
      ),
    );

    // Empty-state callout is in the DOM …
    expect(
      screen.getByTestId("no-models-configured-callout"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No models configured for AI search/i),
    ).toBeInTheDocument();

    // … and the System fallback string is NOT rendered as a selected value
    // anywhere in the trigger (the dropdown itself is replaced).
    expect(screen.queryByText("openai/gpt-5.2")).not.toBeInTheDocument();
  });
});
