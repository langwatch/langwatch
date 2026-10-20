/** @vitest-environment jsdom */
/**
 * Cloud admin's Diagnostics section and the drawer opened from the Slack link.
 * Spec: enterprise/modules/licensing/specs/upgrade-diagnostics.feature
 */
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { InstanceDiagnostics } from "../ui/blocks/instance-diagnostics.tsx";
import SelfHostedInstancesView from "../ui/sections/self-hosted-instances-view.tsx";

const report = {
  id: "report-1",
  instanceId: "inst_aaaaaaaabbbbbbbb",
  stepId: "trace:backfill-span-costs",
  stepDescription: "Fills the cost of every span stored before costs were recorded.",
  release: "3.23.0",
  attempt: 2,
  trigger: "automatic" as const,
  byteLength: 2048,
  receivedAt: "2026-10-20T10:00:00.000Z",
  expiresAt: "2026-11-19T10:00:00.000Z",
};

const calls = vi.hoisted(() => ({
  diagnosticsFor: [] as string[],
  instanceFor: [] as string[],
  downloads: [] as string[],
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    selfHostedInstances: {
      summary: { useQuery: () => ({ data: undefined, error: null, isLoading: true }) },
      getAll: {
        useQuery: () => ({
          data: { instances: [], total: 0 },
          error: null,
          isLoading: false,
          isFetching: false,
        }),
      },
      getById: {
        useQuery: (input: { id: string }, opts?: { enabled?: boolean }) => {
          if (opts?.enabled) calls.instanceFor.push(input.id);
          return { data: undefined, error: null, isLoading: Boolean(opts?.enabled) };
        },
      },
      findDiagnostics: {
        useQuery: (input: { instanceRowId: string }) => {
          calls.diagnosticsFor.push(input.instanceRowId);
          return { data: [report], error: null, isLoading: false };
        },
      },
      getDiagnosticsDownload: {
        useMutation: (options: { onSuccess: (download: { url: string }) => void }) => ({
          mutate: ({ id }: { id: string }) => {
            calls.downloads.push(id);
            options.onSuccess({ url: `https://bucket.test/${id}.json` });
          },
          isPending: false,
          variables: undefined,
        }),
      },
    },
  },
}));

describe("Cloud admin upgrade diagnostics", () => {
  const opened: string[] = [];
  beforeEach(() => {
    calls.diagnosticsFor.length = 0;
    calls.instanceFor.length = 0;
    calls.downloads.length = 0;
    opened.length = 0;
    vi.spyOn(window, "open").mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  describe("given an install with a received diagnostics report", () => {
    /** @scenario "The instance drawer lists the diagnostics and downloads one" */
    it("lists the step, release, attempt and trigger, and Download opens the signed link", () => {
      renderWithOpsHost(<InstanceDiagnostics instanceRowId="shi_1" />);

      expect(calls.diagnosticsFor).toContain("shi_1");
      expect(screen.getByText("trace:backfill-span-costs")).toBeTruthy();
      expect(screen.getByText("3.23.0")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
      expect(screen.getByText("Automatically")).toBeTruthy();
      expect(document.querySelectorAll("time").length).toBe(2);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Download the diagnostics of trace:backfill-span-costs, attempt 2",
        }),
      );

      expect(calls.downloads).toEqual(["report-1"]);
      expect(opened).toEqual(["https://bucket.test/report-1.json"]);
    });
  });

  describe("given the page opened with ?instance=<row id>", () => {
    /** @scenario "The self-hosted instances page opens the drawer from the link Slack carries" */
    it("opens that instance's drawer", () => {
      renderWithOpsHost(<SelfHostedInstancesView />, {
        host: fakeOpsHost({ query: { instance: "shi_42" } }),
      });

      expect(calls.instanceFor).toContain("shi_42");
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });
});
