/**
 * @vitest-environment jsdom
 * What the Upgrades overview, release, step and run sections show for the reader's answers.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  UpgradeRunDetailView,
  UpgradeStatusView,
  UpgradeStepView,
} from "../model/upgrade-view.ts";
import { UpgradeReleaseSteps } from "../ui/sections/upgrade-release-steps.tsx";
import { UpgradeRunPhases } from "../ui/sections/upgrade-run-phases.tsx";
import { UpgradeStepDetail } from "../ui/sections/upgrade-step-detail.tsx";
import { UpgradesOverview } from "../ui/sections/upgrades-overview.tsx";

function renderIn(node: ReactNode) {
  return render(<DesignSystemProvider forcedTheme="light">{node}</DesignSystemProvider>);
}

function statusWith(overrides: Partial<UpgradeStatusView>): UpgradeStatusView {
  return {
    state: "up-to-date",
    label: "Up to date",
    tone: "neutral",
    reason: "current",
    summary: "Release 3.23.0 is current.",
    installed: "3.23.0",
    origin: "recorded",
    image: "3.23.0",
    floor: "3.20.1",
    ledgerFloor: "3.20.1",
    lease: null,
    lastRun: null,
    counts: { done: 4 },
    failedStepIds: [],
    failedTargets: 0,
    ...overrides,
  };
}

function stepWith(overrides: Partial<UpgradeStepView>): UpgradeStepView {
  return {
    id: "prisma:20261006_add_owner",
    kind: "prisma",
    release: "3.23.0",
    mode: "blocking",
    status: "done",
    statusLabel: "Done",
    owner: "ops",
    description: null,
    recorded: true,
    inferred: false,
    attempt: 1,
    lastError: null,
    report: null,
    progress: null,
    runId: null,
    startedAt: "2026-10-06T10:00:00.000Z",
    finishedAt: "2026-10-06T10:00:02.000Z",
    updatedAt: null,
    ...overrides,
  };
}

const noop = () => undefined;

function renderOverview({
  status,
  failedSteps = [],
  backgroundSteps = [],
  backgroundLoading,
  onRetryStep,
}: {
  status: UpgradeStatusView;
  failedSteps?: UpgradeStepView[];
  backgroundSteps?: UpgradeStepView[];
  backgroundLoading?: boolean;
  onRetryStep?: (stepId: string) => void;
}) {
  const onOpenStep = vi.fn();
  renderIn(
    <UpgradesOverview
      status={status}
      releases={[
        { release: "3.23.0", installed: true, image: true, stepCount: 4, counts: { done: 4 } },
      ]}
      runs={[]}
      failedSteps={failedSteps}
      backgroundSteps={backgroundSteps}
      backgroundLoading={backgroundLoading}
      onRetryStep={onRetryStep}
      onOpenRelease={noop}
      onOpenRun={noop}
      onOpenStep={onOpenStep}
    />,
  );
  return { onOpenStep };
}

describe("UpgradesOverview", () => {
  describe("when the installation is on the image's release", () => {
    /** @scenario "The overview names the installed release, the image release and the floor" */
    it("reads up to date and shows the installed release, the image release and the floor", () => {
      renderOverview({ status: statusWith({}) });

      expect(screen.getByTestId("upgrade-installation-state")).toHaveTextContent("Up to date");
      expect(screen.getByTestId("upgrade-installed")).toHaveTextContent("3.23.0");
      expect(screen.getByTestId("upgrade-image")).toHaveTextContent("3.23.0");
      expect(screen.getByTestId("upgrade-floor")).toHaveTextContent("3.20.1");
    });
  });

  describe("when the image is newer than the ledger", () => {
    /** @scenario "An image newer than the ledger reads as behind and names the command" */
    it("reads behind and names the command to run", () => {
      renderOverview({
        status: statusWith({
          state: "behind",
          label: "Behind",
          tone: "warning",
          reason: "image-newer",
          summary: "Image 3.23.0 is newer than the installed 3.22.0. Run the upgrade.",
          installed: "3.22.0",
        }),
      });

      const state = screen.getByTestId("upgrade-installation-state");
      expect(state).toHaveTextContent("Behind");
      expect(state).toHaveTextContent("pnpm task upgrade");
    });
  });

  describe("when the installed release is below the floor", () => {
    /** @scenario "A release below the floor reads as unsupported and names the LTS to upgrade to first" */
    it("reads unsupported and names the LTS release to upgrade to first", () => {
      renderOverview({
        status: statusWith({
          state: "unsupported",
          label: "Unsupported",
          tone: "danger",
          reason: "installed-below-floor",
          summary:
            "Installed release 3.18.0 is below the supported floor 3.20.1. Upgrade to 3.20.1 first.",
          installed: "3.18.0",
        }),
      });

      const state = screen.getByTestId("upgrade-installation-state");
      expect(state).toHaveTextContent("Unsupported");
      expect(state).toHaveTextContent("Upgrade to 3.20.1 first.");
    });
  });

  describe("when no upgrade has been recorded", () => {
    /** @scenario "The overview says when no upgrade has been recorded yet" */
    it("says the installation has not recorded an upgrade yet", () => {
      renderIn(
        <UpgradesOverview
          status={statusWith({ reason: "no-upgrade-recorded", installed: null })}
          releases={[]}
          runs={[]}
          failedSteps={[]}
          onOpenRelease={noop}
          onOpenRun={noop}
          onOpenStep={noop}
        />,
      );

      expect(screen.getByText(/has not recorded an upgrade yet/)).toBeInTheDocument();
    });
  });

  describe("when a step failed", () => {
    /** @scenario "A failed step names its error and its fix and is listed under needs attention" */
    it("lists the step under needs attention with its error, opening the step", () => {
      const failed = stepWith({
        id: "ops:backfill-owner",
        mode: "background",
        status: "failed",
        statusLabel: "Failed",
        lastError: "Owner column missing: run the Prisma migration first",
      });
      const { onOpenStep } = renderOverview({
        status: statusWith({ state: "needs-attention", label: "Needs attention", tone: "danger" }),
        failedSteps: [failed],
      });

      const attention = screen.getByTestId("upgrade-needs-attention");
      expect(attention).toHaveTextContent("Owner column missing: run the Prisma migration first");
      fireEvent.click(within(attention).getByRole("button", { name: /ops:backfill-owner/ }));
      expect(onOpenStep).toHaveBeenCalledWith("ops:backfill-owner");
    });
  });

  describe("when a background step failed", () => {
    const failed = stepWith({
      id: "ops:backfill-owner",
      mode: "background",
      status: "failed",
      statusLabel: "Failed",
      lastError: "Owner column missing",
    });
    const running = stepWith({
      id: "ops:backfill-names",
      mode: "background",
      status: "running",
      statusLabel: "Running",
    });
    const finishing = statusWith({
      state: "finishing-in-background",
      label: "Finishing in background",
      tone: "info",
    });

    /** @scenario "A failed background step offers Retry to a manager" */
    it("offers Retry on the failed step only, to a manager", () => {
      const onRetryStep = vi.fn();
      renderOverview({ status: finishing, backgroundSteps: [failed, running], onRetryStep });

      const list = screen.getByTestId("upgrade-background-steps");
      expect(within(list).getAllByRole("button", { name: "Retry" })).toHaveLength(1);
      const failedRow = screen.getByTestId("upgrade-background-step-ops:backfill-owner");
      fireEvent.click(within(failedRow).getByRole("button", { name: "Retry" }));
      expect(onRetryStep).toHaveBeenCalledWith("ops:backfill-owner");
    });

    /** @scenario "A view-only operator sees the list and no Retry" */
    it("shows the failed step with its error and offers no Retry to a view-only reader", () => {
      renderOverview({ status: finishing, backgroundSteps: [failed, running] });

      const failedRow = screen.getByTestId("upgrade-background-step-ops:backfill-owner");
      expect(failedRow).toHaveTextContent("Failed");
      expect(failedRow).toHaveTextContent("Owner column missing");
      expect(
        within(screen.getByTestId("upgrade-background-steps")).queryByRole("button", {
          name: "Retry",
        }),
      ).toBeNull();
    });

    it("shows a running step's progress from its checkpoint report", () => {
      const replaying = { ...running, progress: { done: 63, total: 100 } };
      renderOverview({ status: finishing, backgroundSteps: [failed, replaying] });

      const row = screen.getByTestId("upgrade-background-step-ops:backfill-names");
      expect(row).toHaveTextContent("63%");
    });

    it("shows a skeleton while the background steps load", () => {
      renderOverview({ status: finishing, backgroundLoading: true });

      expect(screen.getByLabelText("Loading background steps")).toBeInTheDocument();
      expect(screen.queryByTestId("upgrade-background-steps")).toBeNull();
    });
  });
});

describe("UpgradeReleaseSteps", () => {
  describe("when a release has a blocking, a background and an operator step", () => {
    /** @scenario "A release's steps are grouped by mode" */
    it("lists them under Blocking, Background and Operator in that order", () => {
      renderIn(
        <UpgradeReleaseSteps
          release="3.23.0"
          steps={[
            stepWith({ id: "ops:move-blobs", mode: "operator" }),
            stepWith({ id: "ops:backfill", mode: "background" }),
            stepWith({ id: "prisma:20261006_add_owner", mode: "blocking" }),
          ]}
          onOpenStep={noop}
        />,
      );

      const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
      expect(headings).toEqual(["Blocking", "Background", "Operator"]);
    });
  });
});

describe("UpgradeStepDetail", () => {
  describe("when a failed data step carries a checkpoint report", () => {
    /** @scenario "The step drawer shows a step's error, fix and checkpoint, read-only" */
    it("shows its facts, its last error and its report, and offers no action", () => {
      renderIn(
        <UpgradeStepDetail
          step={{
            ...stepWith({
              id: "ops:backfill-owner",
              kind: "data",
              mode: "background",
              status: "failed",
              statusLabel: "Failed",
              owner: "ops",
              lastError: "Owner column missing: run the Prisma migration first",
              report: { checkpoint: "org_42" },
            }),
            targets: [],
          }}
        />,
      );

      const detail = screen.getByTestId("upgrade-step-detail");
      for (const fact of ["ops:backfill-owner", "data", "Background", "3.23.0", "ops"]) {
        expect(detail).toHaveTextContent(fact);
      }
      expect(screen.getByTestId("upgrade-step-error")).toHaveTextContent(
        "Owner column missing: run the Prisma migration first",
      );
      expect(detail).toHaveTextContent("org_42");
      expect(within(detail).queryByRole("button", { name: /run|retry|dry/i })).toBeNull();
    });
  });
});

describe("UpgradeRunPhases", () => {
  describe("when a run passed through two releases", () => {
    /** @scenario "A run's steps are listed per release in the order the reader gives them" */
    it("lists each release's steps under it, in order", () => {
      const run: UpgradeRunDetailView = {
        id: "run_1",
        kind: "upgrade",
        release: "3.23.0",
        floor: "3.20.1",
        startedAt: "2026-10-06T10:00:00.000Z",
        finishedAt: "2026-10-06T10:01:00.000Z",
        outcome: "succeeded",
        plan: null,
        report: null,
        phases: [],
        steps: [
          stepWith({ id: "prisma:a", release: "3.22.0" }),
          stepWith({ id: "clickhouse:00042", kind: "clickhouse", release: "3.22.0" }),
          stepWith({ id: "prisma:b", release: "3.23.0" }),
        ],
      };
      renderIn(<UpgradeRunPhases run={run} />);

      const releases = screen.getAllByTestId("upgrade-run-release");
      expect(releases.map((release) => within(release).getByRole("heading").textContent)).toEqual([
        "3.22.0",
        "3.23.0",
      ]);
      expect(
        within(releases[0]!)
          .getAllByTestId("upgrade-run-step")
          .map((s) => s.textContent),
      ).toEqual([expect.stringContaining("prisma:a"), expect.stringContaining("clickhouse:00042")]);
    });
  });
});

describe("UpgradeRunPhases, phases", () => {
  describe("when a run from 3.21.0 to 3.23.0 passed through two releases", () => {
    /** @scenario "A run's phases are listed in the order they ran" */
    it("lists the preflight first, each release's schema phases in order, the reconcile last", () => {
      const at = "2026-10-06T10:00:00.000Z";
      const phase = (name: string, release: string | null) => ({
        name,
        release,
        startedAt: at,
        finishedAt: at,
        outcome: "succeeded",
      });
      const run: UpgradeRunDetailView = {
        id: "run_2",
        kind: "upgrade",
        release: "3.23.0",
        floor: "3.20.1",
        startedAt: at,
        finishedAt: at,
        outcome: "succeeded",
        plan: null,
        report: null,
        phases: [
          phase("preflight", null),
          phase("postgres-schema", "3.22.0"),
          phase("clickhouse-schema", "3.22.0"),
          phase("postgres-schema", "3.23.0"),
          phase("clickhouse-schema", "3.23.0"),
          phase("reconcile", null),
        ],
        steps: [],
      };
      renderIn(<UpgradeRunPhases run={run} />);

      const rows = screen.getAllByTestId("upgrade-run-phase").map((row) => row.textContent);
      expect(rows).toEqual([
        expect.stringMatching(/^Preflight/),
        expect.stringMatching(/^Postgres schema3\.22\.0/),
        expect.stringMatching(/^ClickHouse schema3\.22\.0/),
        expect.stringMatching(/^Postgres schema3\.23\.0/),
        expect.stringMatching(/^ClickHouse schema3\.23\.0/),
        expect.stringMatching(/^Reconcile/),
      ]);
    });
  });
});
