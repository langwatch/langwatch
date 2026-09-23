/** @vitest-environment jsdom */
/**
 * The self-hosted instance drawer's ladder, domains and usage numbers.
 * Spec: specs/self-hosting/connected-services/instance-registry.feature
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { SelfHostedInstance } from "../model/self-hosted-instance.ts";
import { InstanceDetailDrawer } from "../ui/sections/instance-detail-drawer.tsx";

function instance(overrides: Partial<SelfHostedInstance> = {}): SelfHostedInstance {
  return {
    id: "shi_1",
    instanceId: "inst_aaaaaaaabbbbbbbb",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    version: "1.42.0",
    installMethod: "helm",
    chartVersion: "3.0.0",
    hostname: "langwatch.acme.test",
    environment: "production",
    installedAt: "2026-01-01T00:00:00.000Z",
    reportSchemaVersion: 3,
    organizationId: null,
    issuedLicenseId: null,
    userEmailDomains: { "acme.test": 8, "sub.acme.test": 2 },
    latestReport: {
      users: 10,
      projects: 3,
      first_project_at: "2026-01-02T00:00:00.000Z",
      traces_28d: 1200,
      active_users_28d: 6,
    },
    optionalMetricsReported: true,
    hostnameReported: true,
    reportCount: 30,
    lastUnknownFields: 0,
    raisedSignals: [],
    organizationName: null,
    activity: "reporting",
    ...overrides,
  };
}

const byIdState = vi.hoisted(() => ({
  current: { data: undefined as { instance: SelfHostedInstance; reports: unknown[] } | undefined },
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    selfHostedInstances: {
      getById: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled
            ? { data: byIdState.current.data, error: null, isLoading: false }
            : { data: undefined, error: null, isLoading: false },
      },
    },
  },
}));

function renderDrawer(value: SelfHostedInstance) {
  byIdState.current.data = { instance: value, reports: [] };
  return renderWithOpsHost(<InstanceDetailDrawer instanceRowId={value.id} onClose={vi.fn()} />);
}

describe("InstanceDetailDrawer", () => {
  describe("given an install with reached and unreached rungs, domains and usage", () => {
    /** @scenario The drawer shows the ladder, the domains and the usage numbers */
    it("shows the rungs it reached with the day, the rungs it never reached, and the domains", () => {
      renderDrawer(instance());

      expect(screen.getByText("Created a project")).toBeTruthy();
      expect(
        screen.getByText(new Date("2026-01-02T00:00:00.000Z").toLocaleDateString()),
      ).toBeTruthy();
      expect(screen.getByText("Added a second member")).toBeTruthy();
      expect(screen.getAllByText("never reached").length).toBeGreaterThan(0);
      expect(screen.getByText("acme.test")).toBeTruthy();
      expect(screen.getByText("8 users")).toBeTruthy();
      expect(screen.getByText("1,200")).toBeTruthy();
    });
  });
});
