/**
 * @vitest-environment jsdom
 */
import { CurrentDrawer } from "@langwatch/browser-host/drawer";
import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: undefined,
    organization: undefined,
    team: undefined,
    hasPermission: () => false,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: { id: "share-token-1" }, pathname: "/share/share-token-1" }),
}));

// The drawer surface is its own suite; here it only has to show what it was handed.
vi.mock("../../explorer/trace-drawer/trace-drawer-content.tsx", () => ({
  TraceDrawerContent: ({ trace }: { trace: { name: string } }) => <p>{trace.name}</p>,
}));
vi.mock("../../explorer/trace-drawer/index.ts", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-drawer-chrome" />,
}));

import { traceApi } from "../../../../behavior/trace-api.ts";
import { traceWeb } from "../../../../trace.web.ts";
import SharePage from "../shared-trace-screen.tsx";

const sharedTrace = {
  header: { traceId: "trace-1", timestamp: 1_700_000_000_000, name: "handle_request" },
  spanTree: [{ spanId: "span-1", parentSpanId: null, name: "handle_request" }],
  spansFull: [],
  spanSignals: [],
  events: [],
  resources: null,
  evaluations: [],
  isSpanDetailTruncated: false,
};

function shareTokenLink(): TRPCLink<never> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        if (op.path === "sharedTrace.get") {
          observer.next({ result: { type: "data", data: sharedTrace } });
          observer.complete();
        } else {
          observer.error(new Error(`an anonymous visitor cannot read ${op.path}`) as never);
        }
        return () => void 0;
      });
}

async function openShareLinkAnonymously() {
  await traceWeb.installation.drawers.traceV2Details?.load();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = traceApi.createClient({ links: [shareTokenLink()] });
  return renderWithDesignSystem(
    <traceApi.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/share/share-token-1"]}>
          <Routes>
            <Route
              path="/share/:id"
              element={
                <>
                  <SharePage />
                  <CurrentDrawer drawers={installedModuleDrawers([traceWeb])} />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </traceApi.Provider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the shared trace page, opened with no session", () => {
  /** @scenario "A shared trace opens in the new Trace Explorer surface" */
  it("shows the shared trace filling the page, with no drawer chrome over it", async () => {
    await openShareLinkAnonymously();

    expect(await screen.findByText("handle_request")).toBeInTheDocument();
    expect(screen.getByTestId("share-page-trace")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-drawer-chrome")).not.toBeInTheDocument();
  });
});
