/**
 * @vitest-environment jsdom
 *
 * The workbench end to end, with the transport stubbed at the tRPC client: what
 * goes on the wire when the member presses Run, what does not go on the wire
 * when they do nothing, and where a refusal about parameters is shown.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `test-setup.ts` stubs the router compat layer with an empty query, which
// would make every case here run under the default relative period instead of
// the one the URL names — and "the window the member is looking at is the
// window that is sent" is precisely what these cases are about.
vi.unmock("~/utils/compat/next-router");
vi.mock(
  "~/utils/compat/next-router",
  async () => await vi.importActual<object>("~/utils/compat/next-router"),
);

import { GovernedSqlWorkbench } from "../components/GovernedSqlWorkbench";

import {
  governedSqlResult,
  handledErrorEnvelope,
  SCHEMA_DATASET_NAMES,
  SCHEMA_RESPONSE,
} from "./governedSqlFixtures";

const harness = vi.hoisted(() => ({
  mutation: vi.fn(),
  /** Stands for whatever the member wrote in the specification editor. */
  editedSpec: '{"mark":"point"}',
}));

vi.mock("@trpc/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trpc/client")>();
  return {
    ...actual,
    // The workbench unwraps `utils.client` before binding `mutation`; the stub
    // stands in for the unwrapped client.
    getUntypedClient: () => ({ mutation: harness.mutation }),
  };
});

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ client: {} }),
    analytics: {
      governedSql: {
        schema: {
          useQuery: () => ({
            data: SCHEMA_RESPONSE,
            isLoading: false,
            error: null,
          }),
        },
      },
      savedWorkbenchCharts: {
        getAll: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
        create: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
        update: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
        delete: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
      },
    },
  },
}));

// Monaco reaches the editor through the code-splitting shim, whose lazy
// boundary never resolves under jsdom. Standing a textarea in for the shim's
// result mounts it synchronously; the workbench, the editor component and the
// wiring between them stay real, which is what this suite is about.
//
// The stub deliberately never announces a mount: the workbench then falls back
// to appending inserted text to the draft, which is the path this suite can
// observe.
vi.mock("~/utils/compat/next-dynamic", () => {
  function StubMonacoEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="stub-monaco"
        aria-label="Governed ClickHouse SQL"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: () => StubMonacoEditor };
});

// Chart mode's own behavior is covered by its own suites; what belongs to THIS
// suite is the wiring — which result and which label the workbench hands the
// chart slot. The stub makes both observable.
// It also stands in for the member editing a specification: the text it is
// given is on screen, and the button writes one back. Chart mode holds none of
// that state, which is exactly what this suite has to be able to see.
vi.mock("../components/LazyGovernedSqlChartMode", () => ({
  LazyGovernedSqlChartMode: (props: {
    result: { rows: readonly Record<string, unknown>[] };
    submittedLabel?: string;
    editedSpecText: string | null;
    onEditedSpecTextChange: (text: string | null) => void;
  }) => (
    <div
      data-testid="stub-chart-mode"
      data-submitted-label={props.submittedLabel}
      data-spec-text={props.editedSpecText ?? ""}
    >
      {JSON.stringify(props.result.rows)}
      <button
        type="button"
        onClick={() => props.onEditedSpecTextChange(harness.editedSpec)}
      >
        Edit the specification
      </button>
    </div>
  ),
}));

const SQL =
  "SELECT trace_id FROM analytics.traces_daily WHERE id = {since:String}";

/**
 * The page period every case runs under unless it says otherwise.
 *
 * Absolute rather than a relative preset, so the window is the same instant on
 * every run — a relative preset is anchored to "now" and would make the values
 * the request carries untestable.
 */
const PAGE_PERIOD = {
  startDate: "2026-02-20T00:00:00.000Z",
  endDate: "2026-02-27T00:00:00.000Z",
};

/** What the workbench sends for {@link PAGE_PERIOD}. */
const PAGE_WINDOW = {
  start: new Date(PAGE_PERIOD.startDate),
  end: new Date(PAGE_PERIOD.endDate),
};

/**
 * A real router rather than a stubbed `usePeriodSelector`: the period is read
 * off the URL, and the thing worth proving is that the URL the member is
 * looking at is the window the request carries.
 */
async function renderWorkbench(
  period: { startDate: string; endDate: string } = PAGE_PERIOD,
) {
  const url =
    "/my-project/analytics/query" +
    `?startDate=${encodeURIComponent(period.startDate)}` +
    `&endDate=${encodeURIComponent(period.endDate)}`;

  render(
    <MemoryRouter initialEntries={[url]}>
      <ChakraProvider value={defaultSystem}>
        <GovernedSqlWorkbench projectId="project-1" />
      </ChakraProvider>
    </MemoryRouter>,
  );
  return await screen.findByTestId("stub-monaco");
}

function typeSql(editor: HTMLElement, sql: string) {
  fireEvent.change(editor, { target: { value: sql } });
}

function addParameter({ name, value }: { name: string; value: string }) {
  fireEvent.click(screen.getByRole("button", { name: "Parameters" }));
  fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
  fireEvent.change(screen.getByLabelText("Parameter name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Parameter value"), {
    target: { value },
  });
}

beforeEach(() => {
  harness.mutation.mockReset();
  harness.mutation.mockResolvedValue(governedSqlResult());
});

describe("the governed SQL workbench", () => {
  describe("given an authorized member with a live governed schema", () => {
    describe("when the workbench opens", () => {
      /** @scenario "An authorized member opens Custom query and sees only their live governed schema" */
      it("names the editor and lists exactly the datasets the endpoint returned", async () => {
        await renderWorkbench();

        expect(screen.getByText("Query")).toBeInTheDocument();
        const escapeRegExp = (value: string) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (const name of SCHEMA_DATASET_NAMES) {
          expect(
            screen.getByRole("button", {
              name: new RegExp(`^${escapeRegExp(name)}`),
            }),
          ).toBeInTheDocument();
        }
        expect(harness.mutation).not.toHaveBeenCalled();
      });
    });

    describe("when the member runs a query carrying named scalar parameters", () => {
      /** @scenario "Named scalar parameters accompany the SQL without rewriting it" */
      it("sends the statement unchanged with the parameters beside it", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        addParameter({ name: "since", value: "2026-01-01" });

        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await waitFor(() => expect(harness.mutation).toHaveBeenCalledTimes(1));
        expect(harness.mutation).toHaveBeenCalledWith(
          "analytics.governedSql.query",
          {
            projectId: "project-1",
            sql: SQL,
            parameters: { since: "2026-01-01" },
            // The page's period rides in its own field, never among the named
            // parameters — the backend refuses a request that puts it there.
            timeWindow: PAGE_WINDOW,
          },
          { signal: expect.any(AbortSignal) },
        );
      });
    });

    describe("when time passes and the member keeps typing after a result", () => {
      /** @scenario "Reload is manual only" */
      it("issues no request that the member did not ask for", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await screen.findByTestId("governed-sql-result-summary");
        expect(harness.mutation).toHaveBeenCalledTimes(1);

        await new Promise((resolve) => setTimeout(resolve, 150));
        typeSql(editor, `${SQL} LIMIT 10`);
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(harness.mutation).toHaveBeenCalledTimes(1);
        // The action is back to Run query, waiting for the member to press it.
        expect(
          screen.getByRole("button", { name: "Run query" }),
        ).toBeInTheDocument();
      });
    });

    describe("when the member opens Chart mode on a successful result", () => {
      /** @scenario "Switching between Table and Chart never reruns SQL" */
      it("feeds the chart the submitted result and its query, and sends nothing", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));
        await screen.findByTestId("governed-sql-result-summary");

        await userEvent.click(screen.getByRole("tab", { name: "Chart" }));

        const chart = await screen.findByTestId("stub-chart-mode");
        // The rows the transport returned, not the draft or a re-fetch.
        expect(chart).toHaveTextContent("trace-1");
        // The outcome's own statement describes the chart, collapsed to a line.
        expect(chart).toHaveAttribute("data-submitted-label", SQL);
        expect(harness.mutation).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a query is refused between two runs of a chart the member wrote", () => {
      /** @scenario "A new result reshapes the starter specification until it is edited" */
      it("still has their specification once the query succeeds again", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));
        await screen.findByTestId("governed-sql-result-summary");

        await userEvent.click(screen.getByRole("tab", { name: "Chart" }));
        await userEvent.click(
          await screen.findByRole("button", { name: "Edit the specification" }),
        );
        expect(screen.getByTestId("stub-chart-mode")).toHaveAttribute(
          "data-spec-text",
          harness.editedSpec,
        );

        // A refusal takes the whole result body off the page, chart and all.
        harness.mutation.mockRejectedValue(
          handledErrorEnvelope({ code: "governed_sql_not_permitted" }),
        );
        typeSql(editor, `${SQL} FORMAT JSON`);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));
        await waitFor(() =>
          expect(screen.queryByTestId("stub-chart-mode")).toBeNull(),
        );

        // They fix the statement and run it again: the chart is theirs, not the
        // example they started from.
        harness.mutation.mockResolvedValue(governedSqlResult());
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const chart = await screen.findByTestId("stub-chart-mode");
        expect(chart).toHaveAttribute("data-spec-text", harness.editedSpec);
      });
    });

    describe("when a parameter row carries something the form cannot send", () => {
      /** @scenario "Named scalar parameters accompany the SQL without rewriting it" */
      it("says so on the row and holds Run back rather than dropping it", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        addParameter({ name: "since", value: "not a number" });
        fireEvent.change(screen.getByLabelText("Parameter type"), {
          target: { value: "number" },
        });

        const parameters = screen.getByTestId("governed-sql-parameters");
        expect(within(parameters).getByText("Enter a number.")).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Run query" }),
        ).toBeDisabled();

        // Nothing was sent behind their back while the row was unsendable.
        expect(harness.mutation).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Parameter value"), {
          target: { value: "12" },
        });
        expect(screen.getByRole("button", { name: "Run query" })).toBeEnabled();
      });

      /** @scenario "Named scalar parameters accompany the SQL without rewriting it" */
      it("names a row whose value was filled in without a name", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Parameters" }));
        fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
        fireEvent.change(screen.getByLabelText("Parameter value"), {
          target: { value: "2026-01-01" },
        });

        const parameters = screen.getByTestId("governed-sql-parameters");
        expect(
          within(parameters).getByText("Name this parameter."),
        ).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Run query" }),
        ).toBeDisabled();
      });
    });

    describe("when the backend refuses the submission for missing parameters", () => {
      /** @scenario "A missing bound parameter is reported against the parameter editor" */
      it("keeps the form open under the refusal and closes it once it clears", async () => {
        harness.mutation.mockRejectedValue(
          handledErrorEnvelope({
            code: "governed_sql_parameter_missing",
            meta: { parameters: ["since"] },
          }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const toggle = await screen.findByRole("button", {
          name: "Parameters",
        });
        await waitFor(() =>
          expect(toggle).toHaveAttribute("aria-expanded", "true"),
        );

        // The refusal is answered in this form, so a click cannot close it.
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "true");

        // And once the refusal is gone the form is closed, rather than open
        // because of a flag that had been toggled behind it.
        harness.mutation.mockResolvedValue(governedSqlResult());
        typeSql(editor, `${SQL} LIMIT 1`);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await waitFor(() =>
          expect(toggle).toHaveAttribute("aria-expanded", "false"),
        );
      });

      /** @scenario "A missing bound parameter is reported against the parameter editor" */
      it("lists the missing names at the parameter editor", async () => {
        harness.mutation.mockRejectedValue(
          handledErrorEnvelope({
            code: "governed_sql_parameter_missing",
            meta: { parameters: ["since", "until"] },
          }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const parameters = await screen.findByTestId("governed-sql-parameters");
        await waitFor(() =>
          expect(within(parameters).getByRole("alert")).toHaveTextContent(
            "since, until",
          ),
        );
        expect(within(parameters).getByRole("alert")).toHaveTextContent(
          "Give these parameters a value",
        );
      });
    });

    describe("when the workbench opens on a page whose period selector names a window", () => {
      /** @scenario "The workbench fills the period parameters from the page's period selector" */
      it("shows that window in the spelling the database is bound with", async () => {
        await renderWorkbench();

        expect(screen.getByLabelText("period_start")).toHaveValue(
          "2026-02-20 00:00:00",
        );
        expect(screen.getByLabelText("period_end")).toHaveValue(
          "2026-02-27 00:00:00",
        );
      });

      /** @scenario "The workbench fills the period parameters from the page's period selector" */
      it("shows a different window when the page carries a different period", async () => {
        await renderWorkbench({
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-03-08T06:30:00.000Z",
        });

        expect(screen.getByLabelText("period_start")).toHaveValue(
          "2026-03-01 00:00:00",
        );
        expect(screen.getByLabelText("period_end")).toHaveValue(
          "2026-03-08 06:30:00",
        );
      });
    });

    describe("when the member overrides the window for one query", () => {
      /** @scenario "A one-off window override is what runs, and survives a re-run" */
      it("sends the override on every run, and never as a named parameter", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.change(screen.getByLabelText("period_start"), {
          target: { value: "2026-02-24 09:00:00" },
        });

        fireEvent.click(screen.getByRole("button", { name: "Run query" }));
        await screen.findByTestId("governed-sql-result-summary");
        fireEvent.click(screen.getByRole("button", { name: "Reload" }));

        await waitFor(() => expect(harness.mutation).toHaveBeenCalledTimes(2));
        const overridden = {
          start: new Date("2026-02-24T09:00:00.000Z"),
          end: PAGE_WINDOW.end,
        };
        for (const call of harness.mutation.mock.calls) {
          expect(call[1].timeWindow).toEqual(overridden);
          expect(call[1].parameters ?? {}).not.toHaveProperty("period_start");
        }
      });

      /** @scenario "A one-off window override is what runs, and survives a re-run" */
      it("goes back to the page's period when the override is dropped", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.change(screen.getByLabelText("period_start"), {
          target: { value: "2026-02-24 09:00:00" },
        });

        fireEvent.click(
          screen.getByRole("button", { name: "Use the page period" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await waitFor(() => expect(harness.mutation).toHaveBeenCalledTimes(1));
        expect(harness.mutation.mock.calls[0]![1].timeWindow).toEqual(
          PAGE_WINDOW,
        );
      });
    });

    describe("when the answer's statement declared no time-window parameters", () => {
      /** @scenario "A statement with no period parameters runs, and says so" */
      it("says the query does not follow the page's period", async () => {
        harness.mutation.mockResolvedValue(
          governedSqlResult({ followsTimeWindow: false }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await screen.findByTestId("governed-sql-result-summary");
        expect(
          await screen.findByTestId("does-not-follow-period"),
        ).toHaveTextContent("does not use the time window");
      });

      /** @scenario "A statement with no period parameters runs, and says so" */
      it("says nothing of the kind when the statement did follow it", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await screen.findByTestId("governed-sql-result-summary");
        expect(
          screen.queryByTestId("does-not-follow-period"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the backend refuses a request that set a reserved parameter itself", () => {
      /** @scenario "A caller that supplies a reserved period parameter itself is refused" */
      it("says which rows to remove, at the form that holds them", async () => {
        harness.mutation.mockRejectedValue(
          handledErrorEnvelope({
            code: "governed_sql_reserved_parameter_supplied",
            meta: { parameters: ["period_start"] },
          }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const parameters = await screen.findByTestId("governed-sql-parameters");
        await waitFor(() =>
          expect(within(parameters).getByRole("alert")).toHaveTextContent(
            "period_start",
          ),
        );
        expect(within(parameters).getByRole("alert")).toHaveTextContent(
          "Remove these",
        );
      });
    });
  });
});
