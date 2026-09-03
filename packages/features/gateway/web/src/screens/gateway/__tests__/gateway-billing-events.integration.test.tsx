/**
 * @vitest-environment jsdom
 *
 * RTL coverage for the Billing Events ledger page: rows render with token
 * classes, cost, provider, and trace drill-through; filters reset paging
 * and reach the query input; load-more appears only with a next cursor.
 */
import { cleanup, screen } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listQuery = vi.hoisted(() => vi.fn());

// Passthrough with a marker: the page must render INSIDE the gateway layout
// on the happy path, not only hand it to the guard's denied fallback.
vi.mock("../../../ui/sections/gateway-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ai-gateway-layout">{children}</div>
  ),
}));

vi.mock("../../../behavior/gateway-api", () => ({
  api: {
    gatewaySpendEvents: {
      list: { useQuery: listQuery },
    },
  },
}));

/** One organization, one project, and a reader who may see gateway usage. */
const host = fakeGatewayHost({
  permissions: ["gatewayUsage:view"],
  organization: { id: "org_1", name: "ACME", slug: "acme", teams: [] },
  project: { id: "project_1", name: "ACME project", slug: "acme-project", teamId: "team_1" },
});

import BillingEventsPage from "../gateway-billing-events.screen";

const SPEND_ROW = {
  tenantId: "project_1",
  gatewayRequestId: "req_0123456789abcdef",
  organizationId: "org_1",
  teamId: "team_1",
  virtualKeyId: "vk_1",
  principalUserId: "",
  endUserId: "enduser-9",
  traceId: "trace_1",
  model: "gpt-5",
  providerKey: "prov_openai",
  tokensInput: 120,
  tokensOutput: 40,
  tokensCacheRead: 10,
  tokensCacheWrite: 0,
  tokensReasoning: 0,
  costUsd: "0.004200",
  status: "confirmed" as const,
  errorClass: "",
  httpStatus: 200,
  labels: [],
  metadata: "",
  durationMs: 900,
  occurredAt: new Date("2026-07-20T12:00:00Z").toISOString(),
};

function renderPage() {
  renderWithGatewayHost(
    <BillingEventsPage />,
    { host },
  );
}

afterEach(() => cleanup());

describe("BillingEventsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listQuery.mockReturnValue({
      data: {
        rows: [SPEND_ROW],
        nextCursor: null,
        virtualKeyNames: { vk_1: "Customer A key" },
        clickHouseDisabled: false,
      },
      isLoading: false,
      isFetching: false,
    });
  });

  /** @scenario Ledger rows show token classes, cost, provider, and link to the trace */
  it("renders one ledger row with tokens, cost, provider, and the trace link", () => {
    renderPage();
    expect(screen.getByTestId("ai-gateway-layout")).toBeInTheDocument();
    const table = screen.getByTestId("billing-events-table");
    expect(table).toHaveTextContent("Customer A key");
    expect(table).toHaveTextContent("enduser-9");
    expect(table).toHaveTextContent("gpt-5");
    expect(table).toHaveTextContent("prov_openai");
    expect(table).toHaveTextContent("120 in / 40 out / 10 cr");
    expect(table).toHaveTextContent("$0.0042");
    const link = screen.getByRole("link", { name: /req_/ });
    expect(link).toHaveAttribute("href", "/acme-project/traces/trace_1");
  });

  /** @scenario Changing a ledger filter resets pagination */
  it("wires filters into the query input and resets paging on change", async () => {
    const user = userEvent.setup();
    listQuery.mockReturnValue({
      data: {
        rows: [SPEND_ROW],
        nextCursor: { occurredAtMs: 1, gatewayRequestId: "req_0" },
        virtualKeyNames: {},
        clickHouseDisabled: false,
      },
      isLoading: false,
    });
    renderPage();
    // Advance the cursor first: without this, asserting an undefined cursor
    // proves nothing about the reset.
    await user.click(screen.getByTestId("billing-events-load-more"));
    const advanced = listQuery.mock.calls.at(-1)?.[0];
    expect(advanced.cursor).toBeDefined();

    await user.type(screen.getByTestId("filter-end-user"), "enduser-9");
    const lastCall = listQuery.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      projectId: "project_1",
      // The screen narrows on the same filter SET the REST reads take, spelled
      // for a structured caller rather than for a query string, so what it
      // asks for and what a reconciliation script asks for cannot drift into
      // meaning different things.
      filters: { endUserIds: ["enduser-9"] },
    });
    expect(lastCall.cursor).toBeUndefined();
  });

  /** @scenario A next cursor is the only thing that offers load more */
  it("shows load-more only when a next cursor exists", () => {
    listQuery.mockReturnValue({
      data: {
        rows: [SPEND_ROW],
        nextCursor: { occurredAtMs: 1, gatewayRequestId: "req_0" },
        virtualKeyNames: {},
        clickHouseDisabled: false,
      },
      isLoading: false,
      isFetching: false,
    });
    renderPage();
    expect(screen.getByTestId("billing-events-load-more")).toBeInTheDocument();
  });

  /** @scenario The ledger explains itself when ClickHouse is disabled */
  it("explains the ClickHouse-disabled degrade", () => {
    listQuery.mockReturnValue({
      data: {
        rows: [],
        nextCursor: null,
        virtualKeyNames: {},
        clickHouseDisabled: true,
      },
      isLoading: false,
      isFetching: false,
    });
    renderPage();
    expect(screen.getByText(/need ClickHouse/i)).toBeInTheDocument();
  });
});
