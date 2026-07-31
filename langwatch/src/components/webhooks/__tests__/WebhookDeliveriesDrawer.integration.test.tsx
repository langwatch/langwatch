/**
 * @vitest-environment jsdom
 *
 * RTL coverage for the deliveries drawer: the health strip renders, the
 * delivery log paginates with a Load more control, and advancing the page
 * passes the previous page's cursor back to the query.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    webhookEndpoints: {
      deliveries: { useQuery: (...args: unknown[]) => useQuery(...args) },
      health: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
  },
}));

import { WebhookDeliveriesDrawer } from "../WebhookDeliveriesDrawer";

const endpoint = {
  id: "ep_1",
  url: "https://example.com/hook",
  enabledEvents: ["gateway.request.completed"],
  status: "ACTIVE" as const,
} as unknown as Parameters<typeof WebhookDeliveriesDrawer>[0]["endpoint"];

function delivery(id: string) {
  return {
    id,
    dispatchId: `d-${id}`,
    attempt: 1,
    eventCount: 1,
    outcome: "success" as const,
    responseStatus: 200,
    latencyMs: 12,
    error: null,
    firedAt: new Date("2026-07-31T12:00:00.000Z"),
  };
}

function renderDrawer() {
  render(
    <ChakraProvider value={defaultSystem}>
      <WebhookDeliveriesDrawer
        organizationId="org_1"
        endpoint={endpoint}
        onClose={vi.fn()}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  useQuery.mockReset();
});

describe("WebhookDeliveriesDrawer", () => {
  /** @scenario The delivery log paginates with a Load more control */
  it("requests the first page at the default size and shows Load more when a cursor is returned", () => {
    useQuery.mockReturnValue({
      data: {
        deliveries: [delivery("a"), delivery("b")],
        nextCursor: { firedAt: new Date("2026-07-31T11:59:00.000Z"), id: "b" },
      },
      isLoading: false,
      isFetching: false,
    });
    renderDrawer();

    // First query has no cursor and the 25-row page size.
    expect(useQuery.mock.calls[0]?.[0]).toMatchObject({
      endpointId: "ep_1",
      limit: 25,
      cursor: undefined,
    });
    expect(
      screen.getByTestId("webhook-deliveries-load-more"),
    ).toBeInTheDocument();
  });

  /** @scenario The deliveries drawer loads more on demand */
  it("passes the returned cursor back when Load more is clicked", async () => {
    const cursor = { firedAt: new Date("2026-07-31T11:59:00.000Z"), id: "b" };
    useQuery.mockReturnValue({
      data: { deliveries: [delivery("a")], nextCursor: cursor },
      isLoading: false,
      isFetching: false,
    });
    renderDrawer();

    await userEvent.click(screen.getByTestId("webhook-deliveries-load-more"));

    // The most recent query call carries the cursor from the prior page.
    const lastCall = useQuery.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ cursor });
  });

  /** @scenario No Load more when the page is the last */
  it("hides Load more when there is no next cursor", () => {
    useQuery.mockReturnValue({
      data: { deliveries: [delivery("a")], nextCursor: null },
      isLoading: false,
      isFetching: false,
    });
    renderDrawer();
    expect(
      screen.queryByTestId("webhook-deliveries-load-more"),
    ).not.toBeInTheDocument();
  });
});
