/**
 * @vitest-environment jsdom
 *
 * A card's links never reload the app — exercised against the REAL router.
 *
 * The existing chip tests prove a click calls a MOCKED `router.push`. That
 * leaves a gap: nothing proved react-router actually accepts the push, that
 * the browser's own document navigation is suppressed, and that the panel
 * holding the conversation is still mounted afterwards. This file closes that
 * gap with the real compat layer (`~/utils/compat/next-router`) inside a real
 * `MemoryRouter`, shaped like the app: the transcript lives in a LAYOUT route
 * (ProjectLangyLayout's role) and the pages swap in an <Outlet/> beneath it.
 *
 * The fixture is the live transport exactly as the panel receives it: opencode
 * ran the CLI through `bash`, and the server's envelope retyped the call to
 * `langwatch.trace.search` while keeping the shell payload as its input. The
 * row it earns: a carried "Alert me on this" (the search rides to the
 * automation drawer as its subject) and plain "Open in <surface>" chips for
 * the destinations that cannot hold the search.
 *
 * @see specs/langy/langy-capability-cards.feature
 *      Rule: A card's links never reload the app
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router";

// The global test-setup.ts stubs ~/utils/compat/next-router with an inert
// router. These tests exist to exercise the REAL one — the whole point is
// that the push lands in react-router and the document never navigates.
vi.unmock("~/utils/compat/next-router");
vi.mock(
  "~/utils/compat/next-router",
  async () => await vi.importActual<object>("~/utils/compat/next-router"),
);

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

import { LangyCapabilityRenderer } from "../components/capabilities/LangyCapabilityRenderer";

afterEach(cleanup);

/** A settled trace search exactly as the CLI envelope hands it to the panel. */
const settledTraceSearch = {
  name: "langwatch.trace.search",
  state: "output-available",
  input: {
    command: "langwatch trace search --query 'checkout failed' --limit 25",
  },
  output: JSON.stringify({
    traces: [{ trace_id: "trace_1", input: { value: "checkout failed" } }],
    pagination: { totalHits: 3 },
  }),
};

/**
 * The app in miniature: the panel (and the transcript with its cards) lives in
 * the layout route, the pages swap beneath it — the same structure that lets
 * the real ProjectLangyLayout keep the conversation alive across navigation.
 */
function PanelLayout() {
  const location = useLocation();
  return (
    <>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
      <div data-testid="langy-panel">
        <LangyCapabilityRenderer call={settledTraceSearch} />
      </div>
      <Outlet />
    </>
  );
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={defaultSystem}>
        <MemoryRouter initialEntries={["/demo/messages"]}>
          <Routes>
            <Route element={<PanelLayout />}>
              <Route path="/demo/messages" element={<div>messages page</div>} />
              <Route
                path="/demo/analytics"
                element={<div>analytics page</div>}
              />
              <Route
                path="/demo/annotations"
                element={<div>annotations page</div>}
              />
              <Route path="/demo/traces" element={<div>traces page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ChakraProvider>
    </QueryClientProvider>,
  );
}

const chipRow = () =>
  within(screen.getByTestId("langy-panel")).getByRole("navigation", {
    name: "Suggested next steps",
  });

const chip = (label: string) =>
  within(chipRow()).getByText(label).closest("a") as HTMLAnchorElement;

const click = (target: HTMLElement, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  fireEvent(target, event);
  return event;
};

describe("a card's footer chips under the real app router", () => {
  describe("when I follow a chip to somewhere in LangWatch", () => {
    it("takes me there without a document navigation, and the panel is still there", () => {
      renderApp();

      const event = click(chip("Open in Analytics"));

      // The browser's own navigation was suppressed — this is the whole spec
      // rule: a real navigation would tear down the app and the conversation.
      expect(event.defaultPrevented).toBe(true);
      // …and the SPA actually went there.
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        "/demo/analytics",
      );
      expect(screen.getByText("analytics page")).toBeInTheDocument();
      // The layout — the panel's home — never unmounted, so the conversation
      // (here: the card and its chips) is still on screen.
      expect(chip("Open in Analytics")).toBeInTheDocument();
    });

    it("lands every chip of the row the same way", () => {
      renderApp();

      expect(click(chip("Open in Annotations")).defaultPrevented).toBe(true);
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        "/demo/annotations",
      );
    });

    it("the carried alert chip arrives with the automation drawer's subject prefilled", () => {
      renderApp();

      const event = click(chip("Alert me on this"));

      expect(event.defaultPrevented).toBe(true);
      expect(screen.getByTestId("pathname")).toHaveTextContent("/demo/traces");
      // The drawer params rode the SPA navigation: the automation drawer will
      // open seeded with the search as its subject, through the same
      // `drawer.*` URL channel every drawer opens from.
      const search = screen.getByTestId("search").textContent ?? "";
      const params = new URLSearchParams(search);
      expect(params.get("drawer.open")).toBe("automation");
      expect(params.get("drawer.initialFilterQuery")).toBe(
        '"checkout failed"',
      );
      // The panel — and the card the user just acted on — is still there.
      expect(chip("Alert me on this")).toBeInTheDocument();
    });
  });

  describe("when I treat a chip the way I treat any link", () => {
    it("stays a real anchor whose address can be copied", () => {
      renderApp();

      expect(chip("Open in Analytics").getAttribute("href")).toBe(
        "/demo/analytics",
      );
      expect(chip("Open in Annotations").getAttribute("href")).toBe(
        "/demo/annotations",
      );
      expect(chip("Alert me on this").getAttribute("href")).toBe(
        "/demo/traces?drawer.open=automation&drawer.initialSource=trace&drawer.initialFilterQuery=%22checkout+failed%22#all-traces?q=%22checkout+failed%22",
      );
    });

    it("leaves a command-click to the browser, which is what it means", () => {
      renderApp();

      const event = click(chip("Open in Analytics"), { metaKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        "/demo/messages",
      );
    });
  });
});
