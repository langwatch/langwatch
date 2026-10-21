/**
 * @vitest-environment jsdom
 * What the Upgrades overview, steps, step and run sections show for the reader's answers.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  UpgradeRunDetailView,
  UpgradeStatusView,
  UpgradeStepView,
} from "../model/upgrade-view.ts";
import { UpgradeReleaseSteps } from "../ui/sections/upgrade-release-steps.tsx";
import { UpgradeRunDetail } from "../ui/sections/upgrade-run-phases.tsx";
import { UpgradeRuns } from "../ui/sections/upgrade-runs.tsx";
import { UpgradeStepDetail } from "../ui/sections/upgrade-step-detail.tsx";
import { UpgradeStepsTab } from "../ui/sections/upgrade-steps-tab.tsx";
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
    lease: null,
    lastRun: null,
    counts: { done: 4 },
    failedStepIds: [],
    failedTargets: 0,
    deprecations: [],
    version: { kind: "release", release: "3.23.0" },
    latestRelease: null,
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
    finishBy: null,
    recorded: true,
    inferred: false,
    attempt: 1,
    lastError: null,
    report: null,
    progress: null,
    waitingOn: [],
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
  operatorSteps,
  onRetryStep,
  retryingStepId,
  heldOrganizations,
  sharedInstall,
}: {
  status: UpgradeStatusView;
  operatorSteps?: UpgradeStepView[];
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  heldOrganizations?: number;
  sharedInstall?: boolean;
}) {
  const onOpenStep = vi.fn();
  const onOpenOrganizations = vi.fn();
  renderIn(
    <UpgradesOverview
      status={status}
      hasRuns={true}
      operatorSteps={operatorSteps}
      onRetryStep={onRetryStep}
      retryingStepId={retryingStepId}
      onOpenStep={onOpenStep}
      heldOrganizations={heldOrganizations}
      sharedInstall={sharedInstall}
      onOpenOrganizations={onOpenOrganizations}
    />,
  );
  return { onOpenStep, onOpenOrganizations };
}

function renderStepsTab({
  backgroundSteps = [],
  backgroundLoading,
  onRetryStep,
}: {
  backgroundSteps?: UpgradeStepView[];
  backgroundLoading?: boolean;
  onRetryStep?: (stepId: string) => void;
}) {
  renderIn(
    <UpgradeStepsTab
      releases={[]}
      backgroundSteps={backgroundSteps}
      backgroundLoading={backgroundLoading}
      onRetryStep={onRetryStep}
      onOpenStep={noop}
      releaseSteps={() => null}
    />,
  );
}

describe("UpgradesOverview", () => {
  describe("when the installation runs a release and is up to date", () => {
    /** @scenario "The overview names the running release and one state line" */
    it("reads Running with the release and the one state line Up to date", () => {
      renderOverview({ status: statusWith({}) });

      expect(screen.getByTestId("upgrade-version")).toHaveTextContent("Running 3.23.0");
      expect(screen.getByTestId("upgrade-installation-state")).toHaveTextContent("Up to date");
      expect(document.body).not.toHaveTextContent(/unreleased/i);
    });

    it("reads a development build as the release it contains and its short commit", () => {
      renderOverview({
        status: statusWith({
          version: { kind: "development", containsRelease: "3.20.1", commit: "abc1234def" },
        }),
      });

      expect(screen.getByTestId("upgrade-version")).toHaveTextContent(
        "Development build 3.20.1+abc1234",
      );
    });
  });

  describe("when cloud names a newer release", () => {
    /** @scenario "A newer release is named with its release notes only when cloud names one" */
    it("names it with a release notes link, and nothing when no release is named", () => {
      renderOverview({
        status: statusWith({
          latestRelease: { release: "3.24.0", notesUrl: "https://example.com/notes/3.24.0" },
        }),
      });

      const latest = screen.getByTestId("upgrade-latest-release");
      expect(latest).toHaveTextContent("Newer version 3.24.0 available");
      expect(within(latest).getByRole("link", { name: /Release notes/ })).toHaveAttribute(
        "href",
        "https://example.com/notes/3.24.0",
      );
      cleanup();

      renderOverview({ status: statusWith({}) });
      expect(screen.queryByTestId("upgrade-latest-release")).toBeNull();
    });
  });

  describe("when the image deprecates a table", () => {
    /** @scenario "The overview lists what the image deprecates, its replacement and when it is removed" */
    it("lists it under Deprecated with its notice, its replacement and a future removal", () => {
      renderOverview({
        status: statusWith({
          deprecations: [
            {
              id: "postgres:DataPrivacyProjectScope",
              what: "Postgres table DataPrivacyProjectScope",
              kind: "postgres-table",
              deprecatedIn: null,
              removedIn: null,
              successor: "Project and Team placement",
              notice: "Nothing reads or writes this table any more.",
            },
          ],
        }),
      });

      const table = screen.getByTestId("upgrade-deprecations");
      expect(screen.getByRole("heading", { name: "Deprecated" })).toBeInTheDocument();
      expect(table).toHaveTextContent("Postgres table DataPrivacyProjectScope");
      expect(table).toHaveTextContent("Nothing reads or writes this table any more.");
      expect(table).toHaveTextContent("Project and Team placement");
      expect(table).toHaveTextContent("A future release");
    });

    it("shows no Deprecated section when the register is empty", () => {
      renderOverview({ status: statusWith({}) });

      expect(screen.queryByTestId("upgrade-deprecations")).not.toBeInTheDocument();
    });
  });

  describe("when the worker is upgrading", () => {
    /** @scenario "An upgrade in progress reads as step n of m and names no command" */
    it("reads step n of m and shows no command", () => {
      renderOverview({
        status: statusWith({
          state: "upgrading",
          label: "Upgrading",
          tone: "info",
          reason: "run-in-progress",
          summary: "An upgrade is running.",
          counts: { done: 10, "not-needed": 2, pending: 27, running: 1 },
        }),
      });

      const state = screen.getByTestId("upgrade-installation-state");
      expect(state).toHaveTextContent("Upgrading: step 13 of 40");
      expect(document.body).not.toHaveTextContent(/pnpm/);
    });
  });

  describe("when no upgrade has been recorded", () => {
    /** @scenario "The overview says when no upgrade has been recorded yet" */
    it("says the installation has not recorded an upgrade yet", () => {
      renderIn(
        <UpgradesOverview
          status={statusWith({ reason: "no-upgrade-recorded", installed: null })}
          hasRuns={false}
          onOpenStep={noop}
        />,
      );

      expect(screen.getByText(/has not recorded an upgrade yet/)).toBeInTheDocument();
    });
  });

  describe("when two steps failed", () => {
    const attention = statusWith({
      state: "needs-attention",
      label: "Needs attention",
      tone: "danger",
      reason: "failed-step",
      summary: "2 steps failed.",
      failedStepIds: ["ops:backfill-owner", "prisma:add-owner"],
    });

    /** @scenario "Failed steps read as needs attention with their count and one Retry for a manager" */
    it("reads needs attention with the count, and its one Retry reopens both", () => {
      const onRetryStep = vi.fn();
      renderOverview({ status: attention, onRetryStep });

      const state = screen.getByTestId("upgrade-installation-state");
      expect(state).toHaveTextContent("Needs attention: 2 failed steps");
      fireEvent.click(within(state).getByRole("button", { name: "Retry" }));
      expect(onRetryStep.mock.calls).toEqual([["ops:backfill-owner"], ["prisma:add-owner"]]);
    });

    it("offers no Retry to a view-only reader", () => {
      renderOverview({ status: attention });

      expect(screen.queryByTestId("upgrade-retry-failed")).toBeNull();
    });
  });

  describe("when an up-to-date installation has held organizations", () => {
    /** @scenario "On cloud, held organizations turn Up to date into needs attention linking to the Organizations tab" */
    it("reads needs attention with the count and links to the Organizations tab, naming no owner", () => {
      const { onOpenOrganizations } = renderOverview({
        status: statusWith({}),
        heldOrganizations: 2,
        sharedInstall: true,
      });

      const state = screen.getByTestId("upgrade-installation-state");
      expect(state).toHaveTextContent("Needs attention: 2 organizations held");
      expect(state).not.toHaveTextContent("Up to date");
      expect(screen.queryByTestId("upgrade-held-contact-owner")).toBeNull();
      fireEvent.click(within(state).getByRole("button", { name: "View organizations" }));
      expect(onOpenOrganizations).toHaveBeenCalledTimes(1);
    });

    /** @scenario "On self-hosted, the held organizations line also says to contact the organization owner" */
    it("on self-hosted also says to contact the organization owner", () => {
      renderOverview({ status: statusWith({}), heldOrganizations: 1, sharedInstall: false });

      const state = screen.getByTestId("upgrade-installation-state");
      expect(state).toHaveTextContent("Needs attention: 1 organization held");
      expect(state).toHaveTextContent("Contact the organization owner.");
    });

    it("reads Up to date when no organization is held", () => {
      renderOverview({ status: statusWith({}), heldOrganizations: 0, sharedInstall: false });

      expect(screen.getByTestId("upgrade-installation-state")).toHaveTextContent("Up to date");
      expect(screen.queryByTestId("upgrade-open-held-organizations")).toBeNull();
    });
  });

  describe("when an operator step is unfinished", () => {
    const failed = stepWith({
      id: "ops:reseal-credentials",
      mode: "operator",
      status: "failed",
      statusLabel: "Failed",
      lastError: "Key not loaded",
    });
    const pending = stepWith({
      id: "ops:move-archives",
      mode: "operator",
      status: "pending",
      statusLabel: "Pending",
    });

    /** @scenario "An unfinished operator step shows under Action needed and a failed one offers Retry" */
    it("lists both under Action needed with their status and offers Retry on the failed one only", () => {
      const onRetryStep = vi.fn();
      renderOverview({ status: statusWith({}), operatorSteps: [failed, pending], onRetryStep });

      expect(screen.getByRole("heading", { name: "Action needed" })).toBeInTheDocument();
      const list = screen.getByTestId("upgrade-operator-steps");
      expect(screen.getByTestId("upgrade-operator-step-ops:move-archives")).toHaveTextContent(
        "Pending",
      );
      expect(within(list).getAllByRole("button", { name: "Retry" })).toHaveLength(1);
      const failedRow = screen.getByTestId("upgrade-operator-step-ops:reseal-credentials");
      expect(failedRow).toHaveTextContent("Key not loaded");
      fireEvent.click(within(failedRow).getByRole("button", { name: "Retry" }));
      expect(onRetryStep).toHaveBeenCalledWith("ops:reseal-credentials");
    });
  });
});

describe("UpgradeStepsTab", () => {
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
    /** @scenario "A failed background step offers Retry to a manager" */
    it("offers Retry on the failed step only, to a manager", () => {
      const onRetryStep = vi.fn();
      renderStepsTab({ backgroundSteps: [failed, running], onRetryStep });

      const list = screen.getByTestId("upgrade-background-steps");
      expect(within(list).getAllByRole("button", { name: "Retry" })).toHaveLength(1);
      const failedRow = screen.getByTestId("upgrade-background-step-ops:backfill-owner");
      fireEvent.click(within(failedRow).getByRole("button", { name: "Retry" }));
      expect(onRetryStep).toHaveBeenCalledWith("ops:backfill-owner");
    });

    /** @scenario "A view-only operator sees the list and no Retry" */
    it("shows the failed step with its error and offers no Retry to a view-only reader", () => {
      renderStepsTab({ backgroundSteps: [failed, running] });

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
      renderStepsTab({ backgroundSteps: [failed, replaying] });

      const row = screen.getByTestId("upgrade-background-step-ops:backfill-names");
      expect(row).toHaveTextContent("63%");
    });

    it("names the old serving processes a step waits on", () => {
      const waiting = {
        ...running,
        waitingOn: [
          { role: "worker", image: "img-3.20.1", release: "3.20.1", lastSeenAt: null },
          { role: "api", image: "img-dev", release: null, lastSeenAt: null },
        ],
      };
      renderStepsTab({ backgroundSteps: [failed, waiting] });

      const row = screen.getByTestId("upgrade-background-step-ops:backfill-names");
      expect(row).toHaveTextContent("worker (3.20.1), api (img-dev)");
    });

    /** @scenario "The background step list shows each step's state, progress and deadline" */
    it("shows each step's status, progress and finish-by release, and who a waiting step waits on", () => {
      const replaying = { ...running, progress: { done: 63, total: 100 }, finishBy: "3.24.0" };
      const waiting = stepWith({
        id: "ops:fill-owner",
        mode: "background",
        status: "pending",
        statusLabel: "Waiting",
        finishBy: "3.24.0",
        waitingOn: [
          {
            role: "worker",
            image: "img-3.20.1",
            release: "3.20.1",
            lastSeenAt: "2026-10-09T10:00:00.000Z",
          },
        ],
      });
      const failedBy = { ...failed, finishBy: "3.24.0" };
      renderStepsTab({ backgroundSteps: [failedBy, replaying, waiting] });

      const rows = [
        { id: "ops:backfill-names", label: "Running" },
        { id: "ops:fill-owner", label: "Waiting" },
        { id: "ops:backfill-owner", label: "Failed" },
      ];
      for (const { id, label } of rows) {
        const row = screen.getByTestId(`upgrade-background-step-${id}`);
        expect(row).toHaveTextContent(id);
        expect(row).toHaveTextContent(label);
        expect(row).toHaveTextContent("3.24.0");
      }
      expect(screen.getByTestId("upgrade-background-step-ops:backfill-names")).toHaveTextContent(
        "63%",
      );
      expect(screen.getByTestId("upgrade-background-step-ops:fill-owner")).toHaveTextContent(
        "worker (3.20.1, last seen",
      );
    });

    it("shows a skeleton while the background steps load", () => {
      renderStepsTab({ backgroundLoading: true });

      expect(screen.getByLabelText("Loading background steps")).toBeInTheDocument();
      expect(screen.queryByTestId("upgrade-background-steps")).toBeNull();
    });
  });
});

describe("UpgradeStepsTab, versions", () => {
  describe("when the ledger knows the baseline, two releases and steps no release names", () => {
    it("lists the development build first, then newest first, the baseline as and earlier", () => {
      renderIn(
        <UpgradeStepsTab
          releases={[
            {
              release: "3.18.1",
              installed: false,
              image: false,
              stepCount: 3,
              counts: { done: 3 },
            },
            {
              release: "3.20.1",
              installed: true,
              image: true,
              stepCount: 2,
              counts: { pending: 2 },
            },
            { release: null, installed: false, image: false, stepCount: 1, counts: { done: 1 } },
          ]}
          onOpenStep={noop}
          releaseSteps={() => null}
        />,
      );

      const groups = within(screen.getByTestId("upgrade-releases")).getAllByRole("button");
      expect(groups.map((group) => group.textContent)).toEqual([
        "Development build",
        "3.20.1",
        "3.18.1 and earlier",
      ]);
      expect(screen.getByTestId("upgrade-release-3.20.1")).toHaveTextContent("2 pending");
      expect(document.body).not.toHaveTextContent(/unreleased/i);
    });
  });
});

describe("UpgradeReleaseSteps", () => {
  describe("when a release has hundreds of applied steps and a few still to do", () => {
    const steps = [
      stepWith({ id: "ops:move-blobs", mode: "operator", status: "failed", statusLabel: "Failed" }),
      stepWith({
        id: "ops:backfill",
        mode: "background",
        status: "pending",
        statusLabel: "Waiting",
        waitingOn: [{ role: "worker", image: "img-3.19.4", release: "3.19.4", lastSeenAt: null }],
      }),
      ...Array.from({ length: 200 }, (_, index) =>
        stepWith({
          id: `clickhouse:${index}`,
          kind: "clickhouse-schema",
          owner: null,
          attempt: 0,
          inferred: true,
          startedAt: null,
          finishedAt: null,
        }),
      ),
    ];

    /** @scenario "A release's steps read as a summary, the unfinished ones first, the applied ones collapsed" */
    it("summarises by status and kind, lists the unfinished steps first and collapses the applied ones", async () => {
      renderIn(<UpgradeReleaseSteps release={null} steps={steps} onOpenStep={noop} />);

      const summary = screen.getByTestId("upgrade-steps-summary");
      expect(summary).toHaveTextContent("200 done");
      expect(summary).toHaveTextContent("200 clickhouse-schema");
      const unfinished = screen.getByTestId("upgrade-steps-unfinished");
      expect(within(unfinished).getAllByRole("row")).toHaveLength(3);
      expect(screen.getByTestId("upgrade-step-ops:backfill")).toHaveTextContent(
        "Waiting on worker (3.19.4)",
      );
      expect(screen.queryByTestId("upgrade-step-clickhouse:0")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Applied \(200\)/ }));

      const applied = await screen.findByTestId("upgrade-step-clickhouse:0");
      expect(applied).toHaveTextContent("Recorded done before the ledger, not run");
      expect(applied).not.toHaveTextContent("Unattributed");
      expect(applied).not.toHaveTextContent("Not started");
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
            logTail: [],
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

describe("UpgradeRunDetail", () => {
  describe("when a run passed through two releases", () => {
    /** @scenario "A run's steps are listed per release in the order the reader gives them" */
    it("lists each release's steps under it, in order", async () => {
      const run: UpgradeRunDetailView = {
        id: "run_1",
        kind: "upgrade",
        release: "3.23.0",
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
      renderIn(<UpgradeRunDetail run={run} />);
      fireEvent.click(screen.getByRole("tab", { name: "Steps" }));

      const releases = await screen.findAllByTestId("upgrade-run-release");
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

describe("UpgradeRunDetail, phases", () => {
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
      renderIn(<UpgradeRunDetail run={run} />);

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

function runWith(overrides: Partial<UpgradeRunDetailView>): UpgradeRunDetailView {
  return {
    id: "run_1",
    kind: "upgrade",
    release: "3.23.0",
    startedAt: "2026-10-06T10:00:00.000Z",
    finishedAt: "2026-10-06T10:01:00.000Z",
    outcome: "succeeded",
    plan: { releases: ["3.23.0"] },
    report: { applied: 3 },
    phases: [],
    steps: [],
    ...overrides,
  };
}

describe("UpgradeRuns and UpgradeRunDetail", () => {
  describe("when an operator opens a run from the Runs tab", () => {
    /** @scenario "A run opens as a drawer from the Runs tab with Phases, Steps and Log" */
    it("opens the run, whose tabs are Phases, Steps and Log, the raw JSON behind Details", async () => {
      const onOpenRun = vi.fn();
      renderIn(<UpgradeRuns runs={[runWith({})]} onOpenRun={onOpenRun} />);
      fireEvent.click(screen.getByTestId("upgrade-run-run_1"));
      expect(onOpenRun).toHaveBeenCalledWith("run_1");
      cleanup();

      renderIn(<UpgradeRunDetail run={runWith({})} />);
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Phases",
        "Steps",
        "Log",
      ]);
      fireEvent.click(screen.getByRole("tab", { name: "Log" }));
      await screen.findByTestId("upgrade-run-log");
      expect(screen.queryByTestId("upgrade-run-details")).toBeNull();
      fireEvent.click(screen.getByTestId("upgrade-run-details-toggle"));
      expect(await screen.findByTestId("upgrade-run-details")).toHaveTextContent("Run report");
    });
  });

  describe("when the run imported history from before upgrade tracking", () => {
    /** @scenario "The seed run reads as imported history with a one-line explanation" */
    it("reads Imported history in the list and explains itself in the log", async () => {
      const seed = runWith({ kind: "seed", release: null, plan: null, report: { seeded: {} } });
      renderIn(<UpgradeRuns runs={[seed]} onOpenRun={noop} />);
      expect(screen.getByTestId("upgrade-run-run_1")).toHaveTextContent("Imported history");
      cleanup();

      renderIn(<UpgradeRunDetail run={seed} />);
      expect(screen.getByText(/Imported history/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Log" }));
      expect(await screen.findByTestId("upgrade-run-imported")).toHaveTextContent(
        "before upgrade tracking began",
      );
      expect(screen.getByTestId("upgrade-run-log")).not.toHaveTextContent("seeded");
      expect(document.body).not.toHaveTextContent(/unreleased|Development build/i);
    });
  });
});
