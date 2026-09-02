/**
 * @vitest-environment jsdom
 *
 * The online evaluations page: what a reader sees about live scoring, and which
 * of the three actions goes where.
 *
 * THE PLATFORM PAGE HAD ONE SUITE AND IT COVERED THE TABLE ONLY
 * (`OnlineEvaluationsTable.integration.test.tsx`). Nothing mounted the page, so
 * nothing asserted the two decisions the page actually makes: which edit
 * destination a monitor gets, and what the performance read is asked for.
 *
 * THE EDIT BRANCH IS THE ONE WORTH PINNING. A monitor authored in the retired
 * evaluation wizard keeps its configuration in the experiments workbench; open
 * the drawer on one and the reader gets a form that cannot represent it, saves,
 * and silently loses what the workbench held.
 *
 * Spec: specs/evaluations/evaluation-pages.feature
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeMonitorHost, renderWithMonitorHost } from "../../../testing";
import OnlineEvaluationsScreen from "../online-evaluations.screen";

const { state } = vi.hoisted(() => ({
  state: {
    monitors: [] as Array<Record<string, unknown>>,
    monitorsLoading: false,
    performance: [] as Array<Record<string, unknown>>,
    performanceError: false,
    experiments: [] as Array<Record<string, unknown>>,
  },
}));

const calls = vi.hoisted(() => ({
  performanceQuery: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../behavior/monitor-api", () => {
  const mutation = (spy: (input: unknown) => unknown) => ({
    useMutation: (options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => ({
      isPending: false,
      mutate: (input: unknown, perCall?: { onSettled?: () => void }) => {
        spy(input);
        options?.onSuccess?.();
        perCall?.onSettled?.();
      },
      mutateAsync: async (input: unknown) => spy(input),
    }),
  });

  return {
    monitorApi: {
      monitors: {
        getAllForProject: {
          useQuery: () => ({
            data: state.monitors,
            isLoading: state.monitorsLoading,
            isError: false,
            isSuccess: true,
            refetch: () => {},
          }),
        },
        getPerformanceForProject: {
          useQuery: (input: unknown) => {
            calls.performanceQuery(input);
            return {
              data: state.performance,
              isError: state.performanceError,
              refetch: () => {},
            };
          },
        },
        toggle: mutation(calls.toggle),
        delete: mutation(calls.remove),
        copy: mutation(vi.fn()),
      },
      experiments: {
        getAllByProjectId: { useQuery: () => ({ data: state.experiments }) },
      },
    },
  };
});

const monitor = (overrides: Record<string, unknown> = {}) => ({
  id: "mon_1",
  name: "Relevancy on production",
  checkType: "langevals/answer_relevancy",
  enabled: true,
  executionMode: "ON_MESSAGE",
  experimentId: null,
  ...overrides,
});

beforeEach(() => {
  state.monitors = [monitor()];
  state.monitorsLoading = false;
  state.performance = [];
  state.performanceError = false;
  state.experiments = [];
  calls.performanceQuery.mockReset();
  calls.toggle.mockReset();
  calls.remove.mockReset();
});

afterEach(cleanup);

describe("given a project with no online evaluations", () => {
  describe("when the page is opened", () => {
    /** @scenario "Each online evaluation is one row" */
    it("explains what live scoring is for instead of showing an empty table", () => {
      state.monitors = [];
      renderWithMonitorHost(<OnlineEvaluationsScreen />);

      expect(screen.getByText("No online evaluations yet")).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });
});

describe("given a project with online evaluations and a guardrail", () => {
  beforeEach(() => {
    state.monitors = [
      monitor(),
      monitor({
        id: "mon_2",
        name: "Jailbreak shield",
        executionMode: "AS_GUARDRAIL",
        enabled: false,
      }),
    ];
  });

  describe("when the page is opened", () => {
    /** @scenario "Each online evaluation is one row" */
    it("renders one row each and labels the guardrail as one", () => {
      renderWithMonitorHost(<OnlineEvaluationsScreen />);

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[1]!).getByText("Guardrail")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("Online evaluation")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Paused")).toBeInTheDocument();
    });

    /** @scenario "The performance is asked for in the reader's own time zone" */
    it("asks for the performance in the reader's own time zone", () => {
      renderWithMonitorHost(
        <OnlineEvaluationsScreen />,
        new FakeMonitorHost({ timeZone: "America/New_York" }),
      );

      expect(calls.performanceQuery).toHaveBeenCalledWith({
        projectId: "proj-1",
        timeZone: "America/New_York",
      });
    });

    /** @scenario "Both ways into a monitor's analytics reach the same filtered destination" */
    it("sends the preview and the row action to the same filtered analytics address", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithMonitorHost(<OnlineEvaluationsScreen />);

      const preview = screen.getByRole("link", {
        name: /View analytics for Relevancy on production/,
      });
      await user.click(screen.getByRole("button", { name: /Actions for Relevancy on production/ }));

      // Two ways in, and the spec asks that they reach the SAME place: a row
      // action that widened to the unfiltered analytics would look identical.
      const destinations = new Set(
        (await screen.findAllByRole("link", { name: /View analytics/ }))
          .map((link) => link.getAttribute("href"))
          .filter((href) => href?.includes("mon_1")),
      );

      expect(destinations).toEqual(new Set(["/web-app/analytics/evaluations?evaluationId=mon_1"]));
      expect(preview.getAttribute("href")).toBe(
        "/web-app/analytics/evaluations?evaluationId=mon_1",
      );
    });
  });

  describe("when one is paused", () => {
    /** @scenario "Each online evaluation is one row" */
    it("sends the state the reader asked for rather than the one on screen", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithMonitorHost(<OnlineEvaluationsScreen />);

      await user.click(screen.getByRole("button", { name: /Actions for Relevancy on production/ }));
      await user.click(await screen.findByText("Disable"));

      expect(calls.toggle).toHaveBeenCalledWith({
        id: "mon_1",
        projectId: "proj-1",
        enabled: false,
      });
    });
  });

  describe("when one is deleted", () => {
    /** @scenario "Deleting an online evaluation asks first and reports afterwards" */
    it("asks first and reports afterwards", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = renderWithMonitorHost(<OnlineEvaluationsScreen />);

      await user.click(screen.getByRole("button", { name: /Actions for Relevancy on production/ }));
      await user.click(await screen.findByText("Delete"));

      expect(
        await screen.findByText(/Are you sure you want to delete "Relevancy on production"/),
      ).toBeInTheDocument();
      expect(calls.remove).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(calls.remove).toHaveBeenCalledWith({ id: "mon_1", projectId: "proj-1" });
      await waitFor(() =>
        expect(host.successes.at(-1)).toEqual({ title: "Online evaluation deleted" }),
      );
    });
  });
});

describe("given the performance read failed", () => {
  describe("when the page is opened", () => {
    /** @scenario "An unavailable performance trend says so rather than drawing a flat line" */
    it("says the performance is unavailable rather than drawing a flat line", () => {
      state.performanceError = true;
      renderWithMonitorHost(<OnlineEvaluationsScreen />);

      expect(screen.getByText("Performance unavailable")).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: /Performance trend/ })).toBeNull();
    });
  });
});

describe("given a reader without analytics access", () => {
  describe("when the page is opened", () => {
    /** @scenario "A reader without analytics access is told so rather than shown a dead link" */
    it("says analytics access is required instead of offering a link", () => {
      renderWithMonitorHost(
        <OnlineEvaluationsScreen />,
        new FakeMonitorHost({
          grants: new Set(["evaluations:view", "evaluations:manage"]),
        }),
      );

      expect(screen.getByText("Analytics access required")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /View analytics/ })).toBeNull();
    });
  });
});

describe("given a monitor authored in the retired evaluation wizard", () => {
  beforeEach(() => {
    state.monitors = [monitor({ experimentId: "exp_1" })];
    state.experiments = [
      {
        id: "exp_1",
        slug: "relevancy-wizard",
        workbenchState: { task: "real_time" },
      },
    ];
  });

  describe("when it is edited", () => {
    /** @scenario "Editing a monitor authored in the retired wizard opens the workbench" */
    it("goes to that experiment's workbench rather than to the drawer", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = renderWithMonitorHost(<OnlineEvaluationsScreen />);

      await user.click(screen.getByRole("button", { name: /Actions for Relevancy on production/ }));
      await user.click(await screen.findByText("Edit"));

      expect(host.navigations).toEqual(["/web-app/experiments/workbench/relevancy-wizard"]);
      expect(host.overlays).toEqual([]);
    });
  });
});

describe("given a monitor that was not authored in the retired wizard", () => {
  describe("when it is edited", () => {
    /** @scenario "Editing any other monitor asks the application for the online evaluation drawer" */
    it("asks the application for the online evaluation drawer, naming the monitor", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = renderWithMonitorHost(<OnlineEvaluationsScreen />);

      await user.click(screen.getByRole("button", { name: /Actions for Relevancy on production/ }));
      await user.click(await screen.findByText("Edit"));

      expect(host.overlays).toEqual([
        { drawer: "onlineEvaluation", params: { monitorId: "mon_1" } },
      ]);
      expect(host.navigations).toEqual([]);
    });
  });
});

describe("given a reader who may manage evaluations", () => {
  describe("when the header actions are used", () => {
    /** @scenario "Creating an online evaluation and setting up a guardrail are two different requests" */
    it("asks for the online evaluation drawer and the guardrails drawer separately", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = renderWithMonitorHost(<OnlineEvaluationsScreen />);

      await user.click(screen.getByRole("button", { name: /New Online Evaluation/ }));
      await user.click(screen.getByRole("button", { name: /Set up Guardrail/ }));

      expect(host.overlays).toEqual([{ drawer: "onlineEvaluation" }, { drawer: "guardrails" }]);
    });
  });
});

describe("given a reader who may not manage evaluations", () => {
  describe("when the page is opened", () => {
    /** @scenario "A reader who may not manage evaluations is offered neither create action" */
    it("offers neither create action", () => {
      renderWithMonitorHost(
        <OnlineEvaluationsScreen />,
        new FakeMonitorHost({ grants: new Set(["evaluations:view", "analytics:view"]) }),
      );

      expect(screen.queryByRole("button", { name: /New Online Evaluation/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Set up Guardrail/ })).toBeNull();
    });
  });
});
