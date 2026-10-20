/**
 * @vitest-environment jsdom
 * The step drawer's diagnostics: copy, download, send after a preview, and the recent log.
 * Spec: modules/ops/specs/upgrade-diagnostics.feature
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BUNDLE = { format: 1, step: { id: "ops:backfill/v2" }, omitted: [] };
const BUNDLE_TEXT = JSON.stringify(BUNDLE, null, 2);

let step: Record<string, unknown>;
let availability: { available: boolean; reason: string | null; automatic: boolean };
const fetchDiagnostics = vi.fn();
const sendMutate = vi.fn();

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useUtils: () => ({
      ops: { upgrade: { getDiagnostics: { fetch: fetchDiagnostics }, invalidate: vi.fn() } },
    }),
    ops: {
      upgrade: {
        getStep: {
          useQuery: () => ({ data: step, isError: false, error: null }),
        },
        retryStep: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        diagnosticsAvailability: { useQuery: () => ({ data: availability }) },
        sendDiagnostics: { useMutation: () => ({ mutate: sendMutate, isPending: false }) },
      },
    },
  },
}));

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { UpgradeStepDrawer } from "../ui/sections/upgrade-step-drawer.tsx";

function failedStep(overrides: Record<string, unknown> = {}) {
  return {
    id: "ops:backfill/v2",
    kind: "ops-backfill",
    release: "3.23.0",
    mode: "background",
    status: "failed",
    statusLabel: "Failed",
    owner: "ops",
    description: null,
    finishBy: null,
    recorded: true,
    inferred: false,
    attempt: 2,
    lastError: "boom",
    report: null,
    logTail: ["connecting to postgres", "retrying in 5s"],
    progress: null,
    waitingOn: [],
    runId: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null,
    targets: [],
    ...overrides,
  };
}

function renderDrawer({ isOpsAdmin = true }: { isOpsAdmin?: boolean } = {}) {
  renderWithOpsHost(<UpgradeStepDrawer stepId="ops:backfill/v2" onClose={vi.fn()} />, {
    host: fakeOpsHost({ isOpsAdmin }),
  });
}

beforeEach(() => {
  step = failedStep();
  availability = { available: false, reason: "connect_disabled", automatic: false };
  fetchDiagnostics.mockResolvedValue(BUNDLE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fetchDiagnostics.mockReset();
  sendMutate.mockReset();
});

describe("UpgradeStepDrawer diagnostics", () => {
  describe("given a failed step open in the drawer", () => {
    /** @scenario "The step drawer offers to copy and download the step's diagnostics" */
    it("downloads the bundle as a JSON file named after the step and copies the same text", async () => {
      const blobs: Blob[] = [];
      const createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:diagnostics";
      });
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      const downloads: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloads.push(this.download);
      });
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderDrawer({ isOpsAdmin: false });

      fireEvent.click(await screen.findByTestId("upgrade-step-download-diagnostics"));
      await waitFor(() => expect(downloads).toEqual(["upgrade-diagnostics-ops-backfill-v2.json"]));
      expect(blobs[0]?.type).toBe("application/json");
      expect(await blobs[0]?.text()).toBe(BUNDLE_TEXT);

      fireEvent.click(screen.getByTestId("upgrade-step-copy-diagnostics"));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(BUNDLE_TEXT));
    });
  });

  describe("given a step with a log tail open in the drawer", () => {
    /** @scenario "The step drawer shows the step's recent log lines" */
    it("shows its recent log lines", async () => {
      renderDrawer();

      expect(await screen.findByText("Recent log")).toBeTruthy();
      const log = screen.getByTestId("upgrade-step-log");
      expect(log.textContent).toContain("connecting to postgres");
      expect(log.textContent).toContain("retrying in 5s");
    });
  });

  describe("given diagnostics can be sent to LangWatch", () => {
    beforeEach(() => {
      availability = { available: true, reason: null, automatic: false };
    });

    describe("when an ops admin opens a failed step", () => {
      it("offers Send to LangWatch", async () => {
        renderDrawer({ isOpsAdmin: true });
        expect(await screen.findByTestId("upgrade-step-send-diagnostics")).toBeTruthy();
      });
    });

    describe("when the reader is not an ops admin", () => {
      it("does not offer Send to LangWatch", async () => {
        renderDrawer({ isOpsAdmin: false });
        await screen.findByTestId("upgrade-step-copy-diagnostics");
        expect(screen.queryByTestId("upgrade-step-send-diagnostics")).toBeNull();
      });
    });

    describe("when the step did not fail", () => {
      it("does not offer Send to LangWatch", async () => {
        step = failedStep({ status: "done", statusLabel: "Done", lastError: null });
        renderDrawer({ isOpsAdmin: true });
        await screen.findByTestId("upgrade-step-copy-diagnostics");
        expect(screen.queryByTestId("upgrade-step-send-diagnostics")).toBeNull();
      });
    });

    describe("when the operator chooses Send to LangWatch", () => {
      /** @scenario "Send to LangWatch shows the exact bundle before it is sent" */
      it("previews the bundle first and sends only after confirming", async () => {
        renderDrawer({ isOpsAdmin: true });

        fireEvent.click(await screen.findByTestId("upgrade-step-send-diagnostics"));
        expect(await screen.findByText("Send these diagnostics to LangWatch?")).toBeTruthy();
        expect(sendMutate).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Send" }));
        expect(sendMutate).toHaveBeenCalledWith({ bundle: BUNDLE });
      });
    });
  });

  describe("given diagnostics cannot be sent to LangWatch", () => {
    describe("when an ops admin opens a failed step", () => {
      /** @scenario "Send to LangWatch is not offered where the install cannot reach LangWatch" */
      it("does not offer Send to LangWatch", async () => {
        renderDrawer({ isOpsAdmin: true });
        await screen.findByTestId("upgrade-step-copy-diagnostics");
        expect(screen.queryByTestId("upgrade-step-send-diagnostics")).toBeNull();
      });
    });
  });
});
