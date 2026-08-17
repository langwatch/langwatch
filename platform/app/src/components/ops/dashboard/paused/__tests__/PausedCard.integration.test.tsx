/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { PausedCard } from "../PausedCard";

/**
 * The merged "what is switched off" panel.
 *
 * Spec: specs/ops/ops-dashboard-density.feature ("One question, one place").
 * The point of the panel is that one glance answers for all three mechanisms,
 * so the tests assert on all three at once rather than one section at a time.
 */

const mockScheduledJobs = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    ops: {
      listScheduledJobs: { useQuery: () => mockScheduledJobs() },
      listParkedGroups: {
        useQuery: () => ({ data: undefined, isLoading: true }),
      },
    },
  },
}));

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

const parkedTenant = (
  overrides: Partial<DashboardData["parkedTenants"][number]> = {},
): DashboardData["parkedTenants"][number] =>
  ({
    tenantId: "project_aaaaaaaabbbbbbbb",
    queueName: "trace_processing",
    groupCount: 129_091,
    oldestParkedMs: NOW - 600_000,
    ...overrides,
  }) as DashboardData["parkedTenants"][number];

const scheduledJob = (overrides: Record<string, unknown> = {}) => ({
  id: "sched_1",
  projectId: "project_1",
  targetType: "reportTrigger",
  targetId: "trigger_weekly",
  cron: "0 9 * * 1",
  timezone: "UTC",
  nextRunAt: new Date(NOW),
  lastSlot: null,
  currentSlot: null,
  attempts: 0,
  lastError: null,
  active: true,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...overrides,
});

const renderCard = (
  props: Partial<
    Pick<DashboardData, "parkedTenants" | "parkedTenantsBound" | "pausedKeys">
  > = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <PausedCard
        parkedTenants={props.parkedTenants ?? []}
        parkedTenantsBound={
          props.parkedTenantsBound ?? { total: 0, included: 0 }
        }
        pausedKeys={props.pausedKeys ?? []}
      />
    </ChakraProvider>,
  );

beforeEach(() => {
  mockScheduledJobs.mockReturnValue({ data: [], isLoading: false });
});
afterEach(cleanup);

describe("PausedCard", () => {
  describe("given a parked tenant, a switched-off schedule and a paused subscriber", () => {
    describe("when the dashboard renders", () => {
      /** @scenario Everything switched off is reported together */
      it("reports all three under one panel, each naming its mechanism", () => {
        mockScheduledJobs.mockReturnValue({
          data: [scheduledJob({ active: false })],
          isLoading: false,
        });

        renderCard({
          parkedTenants: [parkedTenant()],
          parkedTenantsBound: { total: 1, included: 1 },
          pausedKeys: ["trace_processing/subscriber"],
        });

        expect(screen.getByText("Switched off")).toBeTruthy();
        expect(screen.getByText("Parked tenants")).toBeTruthy();
        expect(screen.getByText("Switched-off schedules")).toBeTruthy();
        expect(screen.getByText("Paused subscribers")).toBeTruthy();

        expect(screen.getAllByTestId("parked-tenant-row")).toHaveLength(1);
        expect(screen.getAllByTestId("paused-schedule-row")).toHaveLength(1);
        expect(screen.getAllByTestId("paused-subscriber-row")).toHaveLength(1);
      });

      /** @scenario Everything switched off is reported together */
      it("summarises the three counts on one line", () => {
        mockScheduledJobs.mockReturnValue({
          data: [scheduledJob({ active: false })],
          isLoading: false,
        });

        renderCard({
          parkedTenants: [parkedTenant()],
          parkedTenantsBound: { total: 1, included: 1 },
          pausedKeys: ["trace_processing", "metric_processing"],
        });

        expect(
          screen.getByText("1 parked tenant · 1 schedule · 2 subscribers"),
        ).toBeTruthy();
      });
    });
  });

  describe("given only a parked tenant", () => {
    describe("when the paused panel renders", () => {
      /** @scenario Parking is distinguished from being switched off */
      it("describes parking as a capacity limit rather than a failure", () => {
        renderCard({
          parkedTenants: [parkedTenant()],
          parkedTenantsBound: { total: 1, included: 1 },
        });

        expect(
          screen.getByText(/at their in-flight capacity limit/),
        ).toBeTruthy();
        expect(screen.getByText(/nothing has failed/)).toBeTruthy();
      });

      /** @scenario Everything switched off is reported together */
      it("names no mechanism that has nothing to report", () => {
        renderCard({
          parkedTenants: [parkedTenant()],
          parkedTenantsBound: { total: 1, included: 1 },
        });

        expect(screen.queryByText("Switched-off schedules")).toBeNull();
        expect(screen.queryByText("Paused subscribers")).toBeNull();
        expect(screen.getByText("1 parked tenant")).toBeTruthy();
      });

      /** @scenario Everything switched off is reported together */
      it("draws no rule under the only section that has content", () => {
        // Stack interleaves its separator by child count, so passing all three
        // sections and letting the empty two return null ends the card in two
        // stray rules. Only the sections with content are handed to the Stack.
        const { container } = renderCard({
          parkedTenants: [parkedTenant()],
          parkedTenantsBound: { total: 1, included: 1 },
        });

        expect(container.querySelectorAll('[role="separator"]')).toHaveLength(
          0,
        );
      });
    });
  });

  describe("given nothing is parked, switched off or paused", () => {
    describe("when the dashboard renders", () => {
      /** @scenario The paused panel is absent when nothing is switched off */
      it("renders no panel at all", () => {
        const { container } = renderCard();

        expect(container.textContent).toBe("");
      });
    });
  });

  describe("given the schedule page read came back full", () => {
    describe("when the panel renders", () => {
      /** @scenario Everything switched off is reported together */
      it("says the count was taken against a bounded page", () => {
        mockScheduledJobs.mockReturnValue({
          data: Array.from({ length: 200 }, (_unused, index) =>
            scheduledJob({ id: `sched_${index}`, active: index !== 0 }),
          ),
          isLoading: false,
        });

        renderCard();

        expect(
          screen.getByText(/there may be more switched off/i),
        ).toBeTruthy();
      });
    });
  });
});
