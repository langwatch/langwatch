/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSelector } from "../model-selector.tsx";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

// tRPC query returns an empty providers list to simulate a freshly
// created project with zero configured providers.
vi.mock("@langwatch/browser-trpc/workflow-api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [],
          isLoading: false,
        }),
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

describe("<ModelSelector /> empty state", () => {
  afterEach(() => cleanup());

  /** @scenario Empty picker renders a configure CTA instead of the System fallback model id */
  it("renders the NoModelsConfiguredCallout when no enabled providers are available", () => {
    render(
      withProviders(
        <ModelSelector
          model="openai/gpt-5.2"
          options={["openai/gpt-5.2", "openai/gpt-5-mini"]}
          onChange={() => undefined}
          forFeatureLabel="AI search"
        />,
      ),
    );

    // Empty-state callout is in the DOM …
    expect(screen.getByTestId("no-models-configured-callout")).toBeInTheDocument();
    expect(screen.getByText(/No models configured for AI search/i)).toBeInTheDocument();

    // … and the System fallback string is NOT rendered as a selected value
    // anywhere in the trigger (the dropdown itself is replaced).
    expect(screen.queryByText("openai/gpt-5.2")).not.toBeInTheDocument();
  });
});
