/**
 * @vitest-environment jsdom
 *
 * Every coded refusal gets its own presentation, and the words always come from
 * the code-keyed registry rather than from the wire message (which, since
 * #5984, IS the code). The assertions compare against what the registry itself
 * resolves, so they stay true when the copy is reworded and fail if a surface
 * starts writing its own.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { explainHandledError, readHandledError } from "~/features/errors";
import type {
  GovernedSqlDiagnostic,
  GovernedSqlQueryResult,
} from "~/server/analytics/governed-sql";

import { GovernedSqlResultPane } from "../components/GovernedSqlResultPane";
import type {
  GovernedSqlAnswer,
  GovernedSqlRequestState,
} from "../logic/governedSqlRequestState";

import { governedSqlResult, handledErrorEnvelope } from "./governedSqlFixtures";

const SUBMITTED_SQL = "SELECT trace_id FROM analytics.traces_daily";

function stateWith({
  answer,
  draftSql = SUBMITTED_SQL,
  outcomeSql = SUBMITTED_SQL,
  submittedSql = SUBMITTED_SQL,
  inFlight = false,
}: {
  answer: GovernedSqlAnswer | null;
  draftSql?: string;
  /**
   * The snapshot the visible answer belongs to. Comes apart from
   * `submittedSql` whenever a later submission was cancelled before answering.
   */
  outcomeSql?: string;
  /** The LAST submission, answered or not. */
  submittedSql?: string;
  inFlight?: boolean;
}): GovernedSqlRequestState {
  const snapshot = { sql: outcomeSql, parameters: {} };
  return {
    draft: { sql: draftSql, parameters: {} },
    submitted: { sql: submittedSql, parameters: {} },
    submissionId: 1,
    inFlight,
    outcome:
      answer === null
        ? null
        : answer.kind === "result"
          ? { kind: "result", result: answer.result, snapshot }
          : { kind: "error", error: answer.error, snapshot },
  };
}

function renderPane(state: GovernedSqlRequestState, chartSlot?: ReactNode) {
  render(
    <ChakraProvider value={defaultSystem}>
      <GovernedSqlResultPane state={state} chartSlot={chartSlot} />
    </ChakraProvider>,
  );
}

/**
 * Switches result mode the way a member does, and refuses to continue if the
 * mode did not actually change.
 *
 * The guard is the point. The tab selects on focus rather than on a bare click
 * event, so a `fireEvent.click` leaves the mode where it was — and every
 * "still visible in the other mode" assertion downstream would then be true
 * because nothing had moved, which is the quietest way this suite could stop
 * testing anything.
 */
async function selectResultMode(mode: "Table" | "Chart") {
  await userEvent.click(screen.getByRole("tab", { name: mode }));
  expect(screen.getByRole("tab", { name: mode })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** What the registry says for this exact payload. */
function registryCopy(error: unknown) {
  const handled = readHandledError(error);
  if (!handled) throw new Error("fixture is not a handled-error payload");
  return { ...explainHandledError(handled), code: handled.code };
}

/**
 * The registry's copy for a payload, paired with whatever of it the pane put on
 * screen. The tests assert; this only looks.
 */
function renderedCopy(error: unknown) {
  const copy = registryCopy(error);
  return {
    ...copy,
    titleOnScreen: screen.queryByText(copy.title),
    descriptionOnScreen: screen.queryByText(copy.description),
    // The wire message is the slug; it must never reach the member.
    slugOnScreen: screen.queryByText(copy.code),
  };
}

describe("the governed SQL result pane", () => {
  describe("given a result the member has since edited away from", () => {
    describe("when the pane renders", () => {
      /** @scenario "A stale result stays labelled as belonging to the previous submission" */
      it("labels the result as the previous submission's", () => {
        renderPane(
          stateWith({
            answer: { kind: "result", result: governedSqlResult() },
            draftSql: `${SUBMITTED_SQL} LIMIT 10`,
          }),
        );

        const notice = screen.getByTestId("governed-sql-stale-notice");
        expect(notice).toHaveTextContent("Previous submission");
        expect(notice).toHaveTextContent(
          "This is the result of the query you last ran, not of the query in the editor.",
        );
      });

      it("drops the label once the draft matches the snapshot that produced the result", () => {
        renderPane(
          stateWith({
            answer: { kind: "result", result: governedSqlResult() },
          }),
        );

        expect(
          screen.queryByTestId("governed-sql-stale-notice"),
        ).not.toBeInTheDocument();
        // Each statistic is a value element beside a caption element, so the
        // concatenated text content carries no space between the two.
        expect(
          screen.getByTestId("governed-sql-result-summary"),
        ).toHaveTextContent(/1\s*rows returned/);
      });
    });
  });

  describe("given a later submission that was cancelled before it answered", () => {
    describe("when the pane renders", () => {
      /** @scenario "A stale result stays labelled as belonging to the previous submission" */
      it("keeps labelling the visible result even though the draft matches the last submission", () => {
        renderPane(
          stateWith({
            answer: { kind: "result", result: governedSqlResult() },
            // The rows on screen came from the first submission,
            outcomeSql: SUBMITTED_SQL,
            // while the last submission, cancelled mid flight, was this one,
            // which is also what the editor now holds. Comparing the draft
            // against `submitted` here would call these rows current.
            submittedSql: `${SUBMITTED_SQL} LIMIT 10`,
            draftSql: `${SUBMITTED_SQL} LIMIT 10`,
          }),
        );

        expect(
          screen.getByTestId("governed-sql-stale-notice"),
        ).toHaveTextContent("Previous submission");
      });
    });
  });

  describe("given a later submission that failed after an earlier one succeeded", () => {
    describe("when the pane renders", () => {
      /** @scenario "A stale result stays labelled as belonging to the previous submission" */
      it("shows the failure and stops showing any result as current", () => {
        const error = handledErrorEnvelope({
          code: "governed_sql_not_permitted",
          meta: { violations: [] },
        });
        renderPane(stateWith({ answer: { kind: "error", error } }));

        const copy = renderedCopy(error);
        expect(copy.titleOnScreen).toBeInTheDocument();
        // The earlier rows are gone rather than left standing as the answer.
        expect(
          screen.queryByTestId("governed-sql-result-summary"),
        ).not.toBeInTheDocument();
        // And nothing is labelled stale, because the failure IS the current
        // answer for the current draft.
        expect(
          screen.queryByTestId("governed-sql-stale-notice"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the backend refused the statement as unparseable", () => {
    describe("when the pane renders the failure", () => {
      /** @scenario "A statement the validator cannot parse renders registry copy at its location" */
      it("reads the registry copy and names the line and column", () => {
        const error = handledErrorEnvelope({
          code: "governed_sql_unparseable",
          meta: {
            violations: [
              {
                code: "PARSE_FAILED",
                clause: "statement",
                message: "The statement could not be parsed.",
                at: { line: 3, column: 12 },
              },
            ],
          },
        });
        renderPane(stateWith({ answer: { kind: "error", error } }));

        const copy = renderedCopy(error);
        expect(copy.isRegistered).toBe(true);
        expect(copy.titleOnScreen).toBeInTheDocument();
        expect(copy.descriptionOnScreen).toBeInTheDocument();
        expect(copy.slugOnScreen).not.toBeInTheDocument();
        expect(screen.getByText("Line 3, column 12")).toBeInTheDocument();
      });

      /** @scenario "A statement the validator cannot parse renders registry copy at its location" */
      it("still reads the full registry copy when the refusal carries no location", () => {
        const error = handledErrorEnvelope({
          code: "governed_sql_unparseable",
          meta: {
            violations: [
              {
                code: "PARSE_FAILED",
                clause: "statement",
                message: "The statement could not be parsed.",
              },
            ],
          },
        });
        renderPane(stateWith({ answer: { kind: "error", error } }));

        const copy = renderedCopy(error);
        expect(copy.isRegistered).toBe(true);
        expect(copy.description.length).toBeGreaterThan(0);
        expect(copy.titleOnScreen).toBeInTheDocument();
        expect(copy.descriptionOnScreen).toBeInTheDocument();
        expect(copy.slugOnScreen).not.toBeInTheDocument();
        expect(screen.queryByText(/^Line /)).not.toBeInTheDocument();
        expect(
          screen.getByText(
            "The refusal did not say where in the statement the problem is.",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the policy refused the statement", () => {
    describe("when the pane renders the failure", () => {
      /** @scenario "A statement the policy refuses names what to change" */
      it("reads the registry copy and preserves the rules the response named", () => {
        const error = handledErrorEnvelope({
          code: "governed_sql_not_permitted",
          meta: {
            violations: [
              {
                code: "TABLE_NOT_ALLOWED",
                clause: "from",
                message: "The dataset `system.parts` is not available here.",
              },
              {
                code: "GATED_COLUMN",
                clause: "projection",
                message: "The column `total_cost` needs the costs permission.",
              },
            ],
          },
        });
        renderPane(stateWith({ answer: { kind: "error", error } }));

        const copy = renderedCopy(error);
        expect(copy.isRegistered).toBe(true);
        expect(copy.titleOnScreen).toBeInTheDocument();
        expect(copy.descriptionOnScreen).toBeInTheDocument();
        expect(copy.slugOnScreen).not.toBeInTheDocument();
        expect(
          screen.getByText("The dataset `system.parts` is not available here."),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            "The column `total_cost` needs the costs permission.",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the deployment has no governed identity provisioned", () => {
    describe("when the member runs a query", () => {
      /** @scenario "An unprovisioned deployment renders the unavailable state on query" */
      it("renders the unavailable presentation and offers no retry", () => {
        const error = handledErrorEnvelope({
          code: "governed_sql_unavailable",
          httpStatus: 503,
          fault: "platform",
        });
        renderPane(stateWith({ answer: { kind: "error", error } }));

        const copy = renderedCopy(error);
        expect(copy.isRegistered).toBe(true);
        expect(copy.titleOnScreen).toBeInTheDocument();
        expect(copy.descriptionOnScreen).toBeInTheDocument();
        expect(copy.slugOnScreen).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: /try again|retry|reload/i }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the database cancelled the query at its execution ceiling", () => {
    describe("when the pane renders the failure", () => {
      /** @scenario "A query that outruns the database ceiling renders a distinct timeout state" */
      it("renders the timeout copy, distinct from the generic failure copy", () => {
        const timeout = handledErrorEnvelope({ code: "query_timeout" });
        const generic = handledErrorEnvelope({ code: "internal_error" });

        renderPane(stateWith({ answer: { kind: "error", error: timeout } }));

        const copy = renderedCopy(timeout);
        expect(copy.isRegistered).toBe(true);
        expect(copy.titleOnScreen).toBeInTheDocument();
        expect(copy.slugOnScreen).not.toBeInTheDocument();
        expect(copy.title).not.toBe(registryCopy(generic).title);
        // It points at the query, not at the platform.
        expect(copy.description.toLowerCase()).toContain("narrow");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Result modes, statistics, diagnostics and truncation
  // -------------------------------------------------------------------------

  describe("given the member's first query succeeds", () => {
    describe("when the result renders", () => {
      /** @scenario "The first successful result opens in Table mode" */
      it("opens in Table mode with Chart offered beside it", () => {
        renderPane(
          stateWith({ answer: { kind: "result", result: governedSqlResult() } }),
        );

        expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        // Offered, so the member can see charting exists — but not chosen for
        // them.
        expect(screen.getByRole("tab", { name: "Chart" })).toHaveAttribute(
          "aria-selected",
          "false",
        );
        expect(screen.getByRole("table")).toBeInTheDocument();
      });
    });
  });

  describe("given a successful result", () => {
    describe("when the member switches to Chart mode and back", () => {
      /** @scenario "Switching between Table and Chart never reruns SQL" */
      it("issues no request at all", async () => {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockRejectedValue(new Error("the result pane must not fetch"));

        renderPane(
          stateWith({ answer: { kind: "result", result: governedSqlResult() } }),
          <div data-testid="chart-slot">chart</div>,
        );

        await selectResultMode("Chart");
        expect(screen.getByTestId("chart-slot")).toBeInTheDocument();
        await selectResultMode("Table");

        // The result was already in hand; both modes are readings of it.
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      });
    });

    describe("when the result pane renders", () => {
      /** @scenario "Result statistics render beneath the result" */
      it("shows rows returned, elapsed time, rows read, and bytes read", () => {
        renderPane(
          stateWith({
            answer: {
              kind: "result",
              result: governedSqlResult({
                statistics: {
                  elapsedMs: 1_240,
                  rowsRead: 4_500_000,
                  bytesRead: 65_536,
                  rowsReturned: 128,
                },
              }),
            },
          }),
        );

        const summary = screen.getByTestId("governed-sql-result-summary");
        expect(summary).toHaveTextContent("128");
        expect(summary).toHaveTextContent("rows returned");
        expect(summary).toHaveTextContent("1,240 ms");
        expect(summary).toHaveTextContent("elapsed");
        expect(summary).toHaveTextContent("4,500,000");
        expect(summary).toHaveTextContent("rows read");
        expect(summary).toHaveTextContent("64.00 KB");
        expect(summary).toHaveTextContent("bytes read");
      });
    });
  });

  describe("given a wide result the byte ceiling truncated well below the row ceiling", () => {
    /** Far under the 10,000-row ceiling: the bytes ran out first. */
    const truncatedResult = () =>
      governedSqlResult({
        truncated: true,
        statistics: {
          elapsedMs: 320,
          rowsRead: 900_000,
          bytesRead: 8_000_000,
          rowsReturned: 412,
        },
        diagnostics: [
          {
            code: "RESULT_TRUNCATED",
            message:
              "The result was cut off at this API's response ceiling. Aggregate further, or narrow the query, to see the whole answer.",
          },
        ],
      });

    describe("when the truncated state renders", () => {
      /** @scenario "The truncation banner tells the truth about how much arrived" */
      it("cites the rows that actually arrived", () => {
        renderPane(
          stateWith({ answer: { kind: "result", result: truncatedResult() } }),
        );

        expect(
          screen.getByTestId("governed-sql-truncation-banner"),
        ).toHaveTextContent("Showing the first 412 rows");
      });

      /** @scenario "The truncation banner tells the truth about how much arrived" */
      it("never claims a row limit that was not the cause", () => {
        renderPane(
          stateWith({ answer: { kind: "result", result: truncatedResult() } }),
        );

        // The byte ceiling bit at 412 rows. Naming the row ceiling would send
        // the member looking for ten thousand rows that were never coming.
        const pane = screen.getByTestId("governed-sql-result-pane");
        expect(pane.textContent).not.toContain("10,000");
        expect(pane.textContent).not.toContain("10000");
      });

      /** @scenario "The table has intentional loading, empty, error, stale, and truncated states" */
      it("marks the result as partial rather than showing it as whole", () => {
        renderPane(
          stateWith({ answer: { kind: "result", result: truncatedResult() } }),
        );

        expect(
          screen.getByTestId("governed-sql-truncation-banner"),
        ).toHaveTextContent("Partial result");
      });
    });
  });

  describe("given a query is in flight", () => {
    describe("when the pane renders", () => {
      /** @scenario "The table has intentional loading, empty, error, stale, and truncated states" */
      it("says the query is running rather than showing an empty table", () => {
        renderPane(stateWith({ answer: null, inFlight: true }));

        expect(screen.getByTestId("governed-sql-loading")).toHaveTextContent(
          "Running the query",
        );
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a query that returned zero rows", () => {
    describe("when the pane renders", () => {
      /** @scenario "The table has intentional loading, empty, error, stale, and truncated states" */
      it("says the query matched nothing and still reports what it cost", () => {
        renderPane(
          stateWith({
            answer: {
              kind: "result",
              result: governedSqlResult({
                rows: [],
                statistics: {
                  elapsedMs: 11,
                  rowsRead: 240_000,
                  bytesRead: 4_096,
                  rowsReturned: 0,
                },
              }),
            },
          }),
        );

        expect(
          screen.getByTestId("governed-sql-result-empty"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("governed-sql-result-summary"),
        ).toHaveTextContent("rows returned");
      });
    });
  });

  describe("given a response carrying diagnostics", () => {
    const everyDiagnostic: GovernedSqlDiagnostic[] = [
      { code: "RESULT_TRUNCATED", message: "The result was cut off." },
      { code: "POSSIBLE_FANOUT", message: "The join repeats each row." },
      { code: "UNBOUNDED_TIME_RANGE", message: "No condition on occurred_on." },
      { code: "MISSING_TIME_BUCKETS", message: "Two buckets have no rows." },
      {
        code: "INCOMPLETE_COMPARISON_PERIOD",
        message: "The newest period has not finished yet.",
      },
    ];

    const withDiagnostics = (): GovernedSqlQueryResult =>
      governedSqlResult({ truncated: true, diagnostics: everyDiagnostic });

    describe("when the member views the result as a table and as a chart", () => {
      /** @scenario "Backend diagnostics stay visible in both result modes" */
      it("displays every diagnostic unchanged in both modes", async () => {
        renderPane(
          stateWith({ answer: { kind: "result", result: withDiagnostics() } }),
          <div data-testid="chart-slot">chart</div>,
        );

        const messagesOnScreen = () =>
          screen
            .getAllByTestId("governed-sql-diagnostic")
            .map((alert) => alert.textContent);
        const expected = everyDiagnostic.map((one) => one.message);

        for (const message of expected) {
          expect(screen.getByText(message)).toBeInTheDocument();
        }
        expect(messagesOnScreen()).toHaveLength(everyDiagnostic.length);

        await selectResultMode("Chart");

        // A chart rendering is never a reason a warning about its own data
        // stops being read.
        for (const message of expected) {
          expect(screen.getByText(message)).toBeInTheDocument();
        }
        expect(messagesOnScreen()).toHaveLength(everyDiagnostic.length);
      });

      /** @scenario "Backend diagnostics stay visible in both result modes" */
      it("keeps the truncation diagnostic more prominent than the rest in both modes", async () => {
        renderPane(
          stateWith({ answer: { kind: "result", result: withDiagnostics() } }),
          <div data-testid="chart-slot">chart</div>,
        );

        const severities = () =>
          Object.fromEntries(
            screen
              .getAllByTestId("governed-sql-diagnostic")
              .map((alert) => [
                alert.getAttribute("data-diagnostic-code"),
                alert.getAttribute("data-severity"),
              ]),
          );

        const inTableMode = severities();
        expect(inTableMode.RESULT_TRUNCATED).toBe("warning");
        expect(inTableMode.POSSIBLE_FANOUT).toBe("info");
        expect(inTableMode.UNBOUNDED_TIME_RANGE).toBe("info");

        await selectResultMode("Chart");
        expect(severities()).toEqual(inTableMode);
      });
    });
  });
});
