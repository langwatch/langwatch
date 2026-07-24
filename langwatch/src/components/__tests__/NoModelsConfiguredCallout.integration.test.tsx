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

// tRPC queries return an empty providers list to simulate a freshly
// created project with zero configured providers. Stubs both the
// legacy `getAllForProject` and the stored-only
// `listAllForProjectForFrontend` that ModelSelector reads.
vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: { providers: [], modelMetadata: {} },
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
