/**
 * @vitest-environment jsdom
 * The create dashboard dialog validates on submit: Create stays clickable, an empty name
 * is named and focused, and nothing is sent until the name is valid.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../testing.tsx";

const api = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }) },
      create: {
        useMutation: () => ({
          mutate: (input: unknown) => api.sent.push(input),
          isPending: false,
        }),
      },
    },
  },
}));

import { DashboardNameDialog } from "../ui/sections/dashboard-name-dialog.tsx";

describe("the create dashboard dialog", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    api.sent = [];
    render(
      <AnalyticsTestHarness host={new StubAnalyticsHost()}>
        <DashboardNameDialog open onOpenChange={vi.fn()} projectSlug="my-project" />
      </AnalyticsTestHarness>,
    );
    user = userEvent.setup();
  });

  it("names the missing name, focuses it and sends nothing", async () => {
    const input = screen.getByTestId("analytics-dashboard-name-input");
    await user.clear(input);

    const create = screen.getByTestId("analytics-dashboard-create-confirm");
    expect(create).toBeEnabled();
    await user.click(create);

    expect(await screen.findByText("Enter a dashboard name.")).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(api.sent).toEqual([]);
  });

  it("sends the trimmed name once it is valid", async () => {
    const input = screen.getByTestId("analytics-dashboard-name-input");
    await user.clear(input);
    await user.click(screen.getByTestId("analytics-dashboard-create-confirm"));
    await user.type(input, "  Costs  {Enter}");

    expect(api.sent).toEqual([expect.objectContaining({ name: "Costs" })]);
  });
});
