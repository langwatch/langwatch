/**
 * @vitest-environment jsdom
 *
 * The workbench end to end, with the transport stubbed at the tRPC client: what
 * goes on the wire when the member presses Run, what does not go on the wire
 * when they do nothing, and where a refusal about parameters is shown.
 *
 * Spec: specs/analytics/lwql-workbench.feature
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

import { LangWatchQLWorkbench } from "../components/LangWatchQLWorkbench";

import {
  handledErrorEnvelope,
  lwqlResult,
  SCHEMA_DATASET_NAMES,
  SCHEMA_RESPONSE,
} from "./lwqlFixtures";

const harness = vi.hoisted(() => ({
  mutation: vi.fn(),
  /** Stands for whatever the member wrote in the specification editor. */
  editedSpec: '{"mark":"point"}',
  /** What the saved-chart list answers; empty unless a case says otherwise. */
  charts: [] as { id: string; name: string }[],
  /** What opening a saved chart fetches. */
  openableChart: null as null | {
    id: string;
    name: string;
    definition: {
      sql: string;
      parameters: Record<string, string>;
      vegaLiteSpec?: Record<string, unknown>;
    };
  },
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
    useUtils: () => ({
      client: {},
      analytics: {
        savedWorkbenchCharts: {
          getById: {
            fetch: async () => {
              if (!harness.openableChart) throw new Error("no chart to open");
              return harness.openableChart;
            },
          },
          getAll: { invalidate: async () => undefined },
        },
      },
    }),
    analytics: {
      lwql: {
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
          useQuery: () => ({
            data: harness.charts,
            isLoading: false,
            error: null,
          }),
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
        aria-label="LangWatchQL ClickHouse SQL"
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
vi.mock("../components/LazyLangWatchQLChartMode", () => ({
  LazyLangWatchQLChartMode: (props: {
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
        <LangWatchQLWorkbench projectId="project-1" />
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
  harness.mutation.mockResolvedValue(lwqlResult());
  harness.charts = [];
  harness.openableChart = null;
});

describe("the LangWatchQL workbench", () => {
  describe("given an authorized member with a live LangWatchQL schema", () => {
    describe("when the workbench opens", () => {
      /** @scenario "An authorized member opens Custom query and sees only their live LangWatchQL schema" */
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
          "analytics.lwql.query",
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

        await screen.findByTestId("lwql-result-summary");
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
        await screen.findByTestId("lwql-result-summary");

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
        await screen.findByTestId("lwql-result-summary");

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
          handledErrorEnvelope({ code: "lwql_not_permitted" }),
        );
        typeSql(editor, `${SQL} FORMAT JSON`);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));
        await waitFor(() =>
          expect(screen.queryByTestId("stub-chart-mode")).toBeNull(),
        );

        // They fix the statement and run it again: the chart is theirs, not the
        // example they started from.
        harness.mutation.mockResolvedValue(lwqlResult());
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

        const parameters = screen.getByTestId("lwql-parameters");
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

        const parameters = screen.getByTestId("lwql-parameters");
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
            code: "lwql_parameter_missing",
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
        harness.mutation.mockResolvedValue(lwqlResult());
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
            code: "lwql_parameter_missing",
            meta: { parameters: ["since", "until"] },
          }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const parameters = await screen.findByTestId("lwql-parameters");
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

    describe("when a statement declares the granularity step", () => {
      /** The refusal a first run of a granularity statement earns. */
      const awaitingStep = () =>
        handledErrorEnvelope({
          code: "lwql_parameter_missing",
          meta: { parameters: ["period_granularity_seconds"] },
        });

      /** Runs once so the workbench learns the statement declares the step. */
      const revealPicker = async () => {
        harness.mutation.mockRejectedValue(awaitingStep());
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));
        await screen.findByTestId("lwql-granularity");
        return editor;
      };

      /** @scenario "The step a statement declares is offered as a control, not as a parameter to fill in" */
      it("does not ask the member to fill the step in as a parameter", async () => {
        harness.mutation.mockRejectedValue(awaitingStep());

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await screen.findByTestId("lwql-granularity");
        // The catch-22 this pins: the step was listed as a value to type in,
        // and typing it is itself refused as a reserved name.
        const parameters = screen.getByTestId("lwql-parameters");
        expect(
          within(parameters).queryByText("Give these parameters a value"),
        ).toBeNull();
        expect(parameters).not.toHaveTextContent("period_granularity_seconds");
      });

      /** @scenario "The step a statement declares is offered as a control, not as a parameter to fill in" */
      it("still prompts for the member's own missing names, without the step", async () => {
        harness.mutation.mockRejectedValue(
          handledErrorEnvelope({
            code: "lwql_parameter_missing",
            meta: { parameters: ["period_granularity_seconds", "since"] },
          }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const parameters = await screen.findByTestId("lwql-parameters");
        const alert = await within(parameters).findByRole("alert");
        // The member's own omission still has to be reported: filtering the
        // reserved name must not take the rest of the refusal with it.
        expect(alert).toHaveTextContent("Give these parameters a value");
        expect(alert).toHaveTextContent("since");
        expect(alert).not.toHaveTextContent("period_granularity_seconds");
      });

      /** @scenario "The step a statement declares is offered as a control, not as a parameter to fill in" */
      it("offers exactly the steps the contract admits", async () => {
        await revealPicker();

        const picker = screen.getByTestId("lwql-granularity");
        for (const label of ["1 second", "1 minute", "1 hour"]) {
          expect(
            within(picker).getByRole("button", { name: label }),
          ).toBeTruthy();
        }
      });

      /** @scenario "Choosing a step sends it beside the query rather than among its parameters" */
      it("sends the chosen step in its own field, never as a parameter", async () => {
        await revealPicker();
        harness.mutation.mockResolvedValue(
          lwqlResult({ followsGranularity: true, granularitySeconds: 60 }),
        );

        fireEvent.click(screen.getByRole("button", { name: "1 minute" }));
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await waitFor(() => {
          const [, input] = harness.mutation.mock.calls.at(-1) ?? [];
          expect(input).toMatchObject({ granularitySeconds: 60 });
        });
        const [, input] = harness.mutation.mock.calls.at(-1) ?? [];
        const sent = input as { parameters?: Record<string, unknown> };
        // Sending it as a parameter is what the backend refuses outright.
        expect(sent.parameters ?? {}).not.toHaveProperty(
          "period_granularity_seconds",
        );
      });

      /** @scenario "Choosing a step sends it beside the query rather than among its parameters" */
      it("sends the step shown as pressed when the member runs without picking", async () => {
        await revealPicker();

        // The default renders as pressed the moment the picker appears...
        expect(screen.getByRole("button", { name: "1 hour" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        // ...so running without a click must send that very step. A picker
        // that shows a pressed default but sends nothing earns the
        // missing-parameter refusal again — for the reserved name, which the
        // prompt filter cannot show — leaving a prompt with nothing to name.
        harness.mutation.mockResolvedValue(
          lwqlResult({ followsGranularity: true, granularitySeconds: 3600 }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await waitFor(() => {
          const [, input] = harness.mutation.mock.calls.at(-1) ?? [];
          expect(input).toMatchObject({ granularitySeconds: 3600 });
        });
        // And nothing prompts for a value: the alert that would have named
        // the reserved step names nothing at all, so it must not render.
        const parameters = screen.getByTestId("lwql-parameters");
        expect(within(parameters).queryByRole("alert")).toBeNull();
      });

      /** @scenario "A step too fine for the window is refused where the member chose it" */
      it("shows the too-fine refusal when the chosen step overflows the budget", async () => {
        await revealPicker();
        harness.mutation.mockRejectedValue(
          handledErrorEnvelope({
            code: "lwql_granularity_too_fine",
            meta: {
              granularitySeconds: 1,
              maxBuckets: 10_000,
            },
          }),
        );

        fireEvent.click(screen.getByRole("button", { name: "1 second" }));
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        // Reachable at all is the point: before the picker there was no way to
        // ask for a step, so this refusal could not be produced from the UI.
        await waitFor(() => {
          const [, input] = harness.mutation.mock.calls.at(-1) ?? [];
          expect(input).toMatchObject({ granularitySeconds: 1 });
        });
        expect(
          await screen.findByText(
            "That granularity would return too many datapoints",
          ),
        ).toBeTruthy();
      });

      /** @scenario "Choosing a step sends it beside the query rather than among its parameters" */
      it("sends no step for a statement that never declared one", async () => {
        harness.mutation.mockResolvedValue(lwqlResult());

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await waitFor(() => expect(harness.mutation).toHaveBeenCalled());
        expect(screen.queryByTestId("lwql-granularity")).toBeNull();
        const [, input] = harness.mutation.mock.calls.at(-1) ?? [];
        // A step sent for an undeclared statement is a reserved value the
        // backend refuses.
        expect(input).not.toHaveProperty("granularitySeconds");
      });

      // The two cases below pin `useWorkbenchGranularity`'s own state, held
      // across renders and keyed on `openedRevision` rather than derived from
      // the live result. Deriving "does this statement declare the step" from
      // the result it feeds `setGranularity` fed back into staleness and
      // looped the render; writing the shown default into the draft on
      // appearance marked the refusal snapshot stale and withdrew every other
      // annotation the refusal carried, including the member's own missing
      // parameters. Neither failure is visible from a single chart — both
      // need the multi-run, multi-chart sequence these reproduce.
      describe("when a saved chart is opened after the picker was showing", () => {
        /** @scenario "The step a statement declares is offered as a control, not as a parameter to fill in" */
        it("hides the picker for a statement that does not declare the step, and never sends the previous chart's chosen step", async () => {
          harness.charts = [
            { id: "chart-a", name: "Chart A" },
            { id: "chart-b", name: "Chart B" },
          ];
          harness.openableChart = {
            id: "chart-a",
            name: "Chart A",
            definition: { sql: SQL, parameters: {} },
          };

          const editor = await renderWorkbench();
          await userEvent.click(screen.getByTestId("open-saved-chart"));
          await userEvent.click(await screen.findByText("Chart A"));

          // Chart A's first run is refused for the unfilled step: the picker
          // appears and the member picks something other than the default.
          harness.mutation.mockRejectedValue(awaitingStep());
          fireEvent.click(screen.getByRole("button", { name: "Run query" }));
          await screen.findByTestId("lwql-granularity");
          fireEvent.click(screen.getByRole("button", { name: "1 second" }));
          expect(
            screen.getByRole("button", { name: "1 second" }),
          ).toHaveAttribute("aria-pressed", "true");

          // Opening Chart B replaces the statement with one that never
          // declares the parameter — nothing has run for it yet, so there is
          // no refusal to derive "declared" from either way.
          harness.openableChart = {
            id: "chart-b",
            name: "Chart B",
            definition: { sql: "SELECT 1", parameters: {} },
          };
          await userEvent.click(screen.getByTestId("open-saved-chart"));
          await userEvent.click(await screen.findByText("Chart B"));

          // No leftover picker, and no leftover pick: the workbench must not
          // go on sending Chart A's `1 second` for a statement that never
          // asked for a step, which the backend refuses as a reserved value.
          expect(screen.queryByTestId("lwql-granularity")).toBeNull();
          harness.mutation.mockResolvedValue(lwqlResult());
          typeSql(editor, "SELECT 1");
          fireEvent.click(screen.getByRole("button", { name: "Run query" }));

          await waitFor(() => expect(harness.mutation).toHaveBeenCalled());
          const [, input] = harness.mutation.mock.calls.at(-1) ?? [];
          expect(input).not.toHaveProperty("granularitySeconds");
        });

        /** @scenario "The step a statement declares is offered as a control, not as a parameter to fill in" */
        it("shows the picker at its default step for a chart that declares it fresh, not the previous chart's pick", async () => {
          harness.charts = [
            { id: "chart-a", name: "Chart A" },
            { id: "chart-b", name: "Chart B" },
          ];
          harness.openableChart = {
            id: "chart-a",
            name: "Chart A",
            definition: { sql: SQL, parameters: {} },
          };

          await renderWorkbench();
          await userEvent.click(screen.getByTestId("open-saved-chart"));
          await userEvent.click(await screen.findByText("Chart A"));

          harness.mutation.mockRejectedValue(awaitingStep());
          fireEvent.click(screen.getByRole("button", { name: "Run query" }));
          await screen.findByTestId("lwql-granularity");
          fireEvent.click(screen.getByRole("button", { name: "1 second" }));

          // Chart B declares the step too, but has never been run — its own
          // first refusal is what reveals its picker.
          harness.openableChart = {
            id: "chart-b",
            name: "Chart B",
            definition: { sql: SQL, parameters: {} },
          };
          await userEvent.click(screen.getByTestId("open-saved-chart"));
          await userEvent.click(await screen.findByText("Chart B"));
          expect(screen.queryByTestId("lwql-granularity")).toBeNull();

          fireEvent.click(screen.getByRole("button", { name: "Run query" }));
          await screen.findByTestId("lwql-granularity");

          // The coarsest offered step is the default shown before anyone has
          // picked for THIS chart — never Chart A's leftover `1 second`.
          expect(
            screen.getByRole("button", { name: "1 hour" }),
          ).toHaveAttribute("aria-pressed", "true");
          expect(
            screen.getByRole("button", { name: "1 second" }),
          ).toHaveAttribute("aria-pressed", "false");
        });
      });

      describe("when a saved chart declaring the step is opened and the member has not picked", () => {
        /** @scenario "The step a statement declares is offered as a control, not as a parameter to fill in" */
        it("still shows the window prompt for a statement missing both the window and the step", async () => {
          harness.charts = [{ id: "chart-1", name: "Traces per day" }];
          harness.openableChart = {
            id: "chart-1",
            name: "Traces per day",
            definition: { sql: SQL, parameters: {} },
          };

          await renderWorkbench();
          await userEvent.click(screen.getByTestId("open-saved-chart"));
          await userEvent.click(await screen.findByText("Traces per day"));

          // The refusal names the reserved step alongside a name the member
          // owns — the exact shape a statement missing both a window
          // parameter and the step earns on its first run.
          harness.mutation.mockRejectedValue(
            handledErrorEnvelope({
              code: "lwql_parameter_missing",
              meta: { parameters: ["period_granularity_seconds", "since"] },
            }),
          );
          fireEvent.click(screen.getByRole("button", { name: "Run query" }));

          // The picker appears, and appearing must not by itself dirty the
          // draft: if showing the default step marked the refusal snapshot
          // stale, `failureView` would withdraw every annotation the refusal
          // carried, including the prompt below for the member's own missing
          // name — silently, with nothing on screen to explain why.
          await screen.findByTestId("lwql-granularity");
          const parameters = await screen.findByTestId("lwql-parameters");
          const alert = await within(parameters).findByRole("alert");
          expect(alert).toHaveTextContent("Give these parameters a value");
          expect(alert).toHaveTextContent("since");
          expect(alert).not.toHaveTextContent("period_granularity_seconds");
        });
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
        await screen.findByTestId("lwql-result-summary");
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

      // The gap this closes: the fields keep showing what was typed while it
      // is invalid, so without the gate Run would execute the last committed
      // window — one the member is no longer looking at.
      it("holds Run while the visible text does not name a runnable window", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);

        fireEvent.change(screen.getByLabelText("period_start"), {
          target: { value: "2026-02-30 12:00:00" },
        });
        expect(
          screen.getByRole("button", { name: "Run query" }),
        ).toBeDisabled();

        fireEvent.change(screen.getByLabelText("period_start"), {
          target: { value: "2026-02-24 09:00:00" },
        });
        expect(screen.getByRole("button", { name: "Run query" })).toBeEnabled();
      });
    });

    describe("when a saved chart is opened while a window override is held", () => {
      it("drops the override, so the opened chart follows the page's period", async () => {
        harness.charts = [{ id: "chart-1", name: "Traces per day" }];
        harness.openableChart = {
          id: "chart-1",
          name: "Traces per day",
          definition: { sql: "SELECT 1", parameters: {} },
        };

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.change(screen.getByLabelText("period_start"), {
          target: { value: "2026-02-24 09:00:00" },
        });
        expect(screen.getByText("Set for this query")).toBeInTheDocument();

        await userEvent.click(screen.getByTestId("open-saved-chart"));
        await userEvent.click(await screen.findByText("Traces per day"));

        await waitFor(() =>
          expect(
            screen.getByText("From the period on this page"),
          ).toBeInTheDocument(),
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
          lwqlResult({ followsTimeWindow: false }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await screen.findByTestId("lwql-result-summary");
        expect(
          await screen.findByTestId("does-not-follow-period"),
        ).toHaveTextContent("does not use the time window");
      });

      /** @scenario "A statement with no period parameters runs, and says so" */
      it("says nothing of the kind when the statement did follow it", async () => {
        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        await screen.findByTestId("lwql-result-summary");
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
            code: "lwql_reserved_parameter_supplied",
            meta: { parameters: ["period_start"] },
          }),
        );

        const editor = await renderWorkbench();
        typeSql(editor, SQL);
        fireEvent.click(screen.getByRole("button", { name: "Run query" }));

        const parameters = await screen.findByTestId("lwql-parameters");
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
