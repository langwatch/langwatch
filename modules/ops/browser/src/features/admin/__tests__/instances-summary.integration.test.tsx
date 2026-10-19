/** @vitest-environment jsdom */
/**
 * The summary above the self-hosted installs list: the counts, and the signal and install
 * rows that narrow or open the list.
 * Spec: specs/self-hosting/connected-services/instance-registry.feature
 */
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type {
  SelfHostedInstance,
  SelfHostedInstanceSummary,
} from "../model/self-hosted-instance.ts";
import { InstancesSummary } from "../ui/blocks/instances-summary.tsx";

const busy: SelfHostedInstance = {
  id: "shi_busy",
  instanceId: "inst_busy",
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  lastSeenAt: "2026-10-15T00:00:00.000Z",
  version: "3.20.1",
  installMethod: "helm",
  chartVersion: null,
  hostname: "llm.bigco.test",
  environment: null,
  installedAt: null,
  reportSchemaVersion: 3,
  organizationId: null,
  issuedLicenseId: null,
  userEmailDomains: { "bigco.test": 40 },
  latestReport: { traces_28d: 231200 },
  optionalMetricsReported: true,
  hostnameReported: true,
  reportCount: 14,
  lastUnknownFields: 0,
  raisedSignals: ["sustained_ingestion"],
  organizationName: null,
  activity: "reporting",
};

const summary: SelfHostedInstanceSummary = {
  total: 20,
  reporting: 12,
  quiet: 5,
  gone: 3,
  licensed: 2,
  newLast7Days: 4,
  newLast30Days: 9,
  traces28d: 254000,
  newPerWeek: Array.from({ length: 12 }, (_, week) => ({
    weekStart: new Date(Date.UTC(2026, 6, 23 + week * 7)).toISOString(),
    count: week % 3,
  })),
  signals: [{ signal: "sustained_ingestion", count: 3 }],
  busiestOpenSource: [busy],
  releases: [{ version: "3.20.1", count: 7 }],
};

describe("<InstancesSummary/>", () => {
  describe("given a registry with installs, a signal and a busy open source install", () => {
    it("shows the counts and hints an operator reads first", () => {
      renderWithOpsHost(
        <InstancesSummary
          summary={summary}
          activeSignal={undefined}
          onSignal={vi.fn()}
          onOpen={vi.fn()}
        />,
      );

      expect(screen.getByText("Reporting")).toBeTruthy();
      expect(screen.getByText("12")).toBeTruthy();
      expect(screen.getByText("5 quiet, 3 gone, 20 in all")).toBeTruthy();
      expect(screen.getByText("9 in the last 30 days")).toBeTruthy();
      expect(screen.getByText("18 open source")).toBeTruthy();
      expect(screen.getByText("3.20.1")).toBeTruthy();
    });

    it("narrows the list by a signal, and lets the operator clear it again", () => {
      const onSignal = vi.fn();
      const { rerenderWithOpsHost } = renderWithOpsHost(
        <InstancesSummary
          summary={summary}
          activeSignal={undefined}
          onSignal={onSignal}
          onOpen={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /Sustained ingestion/ }));
      expect(onSignal).toHaveBeenLastCalledWith("sustained_ingestion");

      rerenderWithOpsHost(
        <InstancesSummary
          summary={summary}
          activeSignal="sustained_ingestion"
          onSignal={onSignal}
          onOpen={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Sustained ingestion/ }));
      expect(onSignal).toHaveBeenLastCalledWith(undefined);
    });

    it("opens the busiest open source install by its leading domain", () => {
      const onOpen = vi.fn();
      renderWithOpsHost(
        <InstancesSummary
          summary={summary}
          activeSignal={undefined}
          onSignal={vi.fn()}
          onOpen={onOpen}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /bigco\.test/ }));

      expect(onOpen).toHaveBeenCalledWith("shi_busy");
    });
  });

  describe("given the summary is still loading", () => {
    it("shows the tile skeleton rather than zeros", () => {
      renderWithOpsHost(
        <InstancesSummary
          summary={undefined}
          activeSignal={undefined}
          onSignal={vi.fn()}
          onOpen={vi.fn()}
        />,
      );

      expect(screen.queryByText("Reporting")).toBeNull();
    });
  });
});
