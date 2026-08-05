/**
 * @vitest-environment jsdom
 *
 * Integration tests for the per-run "Export report" action in run history.
 *
 * The rows and the hook are exercised together, because the thing worth
 * proving is the wiring between them: which run a click reports on, that a
 * click never toggles the row it came from, and that two rows can be producing
 * a report at the same time without one cancelling the other.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunRow } from "../RunRow";
import { useBatchRunReport } from "../useBatchRunReport";
import { makeBatchRun, makeSummary } from "./test-helpers";

const showErrorToastMock = vi.fn();
const toasterCreateMock = vi.fn();

vi.mock("../usePrefetchRunState", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

vi.mock("~/features/errors", () => ({
  showErrorToast: (...args: unknown[]) => showErrorToastMock(...args),
  readHandledError: () => false,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toasterCreateMock(...args) },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

type PendingRequest = {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  resolve: (response: unknown) => void;
};

const pendingRequests: PendingRequest[] = [];
const downloadedFilenames: (string | null)[] = [];

/**
 * A fetch that hands back a promise the test resolves by hand, so a report can
 * be left mid-flight while another one starts.
 */
function installFetchMock() {
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    return new Promise((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener("abort", () => {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";
        reject(abortError);
      });
      pendingRequests.push({
        url,
        body: JSON.parse(init.body as string) as Record<string, unknown>,
        signal,
        resolve,
      });
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * The endpoint answers with NDJSON: a line per stage while the report is being
 * built, then one final line carrying the document. Faking that shape rather
 * than a plain body is what makes these tests exercise the reader the hook
 * actually runs — a blob-shaped fake passes through it without ever
 * downloading anything.
 */
/** One NDJSON body, read in a single chunk, as the fetch mock returns it. */
function ndjsonResponse(lines: string[]) {
  const encoded = new TextEncoder().encode(lines.join("\n"));
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "application/x-ndjson" }),
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: () =>
            Promise.resolve(
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: encoded }),
            ),
          cancel: () => Promise.resolve(),
        };
      },
    },
  };
}

/**
 * The document delivered, then the connection cut part-way through whatever
 * came next. The trailing fragment is not valid JSON, which is the case that
 * used to throw over a file already on disk.
 */
function truncatedAfterDocumentResponse({ filename }: { filename: string }) {
  return ndjsonResponse([
    JSON.stringify({ stage: "reading" }),
    JSON.stringify({
      done: true,
      tier: "verified",
      filename,
      html: "<html></html>",
    }),
    '{"stage":"render',
  ]);
}

/** A failure raised after the first byte, so it travels as a line. */
function streamFailureResponse(code: string) {
  return ndjsonResponse([
    JSON.stringify({ stage: "reading" }),
    JSON.stringify({ error: code }),
    "",
  ]);
}

function reportResponse({
  tier = "verified",
  filename = "checkout-suite-report.html",
  stages = ["reading", "measuring"],
}: {
  tier?: string;
  filename?: string;
  stages?: string[];
} = {}) {
  const lines = [
    ...stages.map((stage) => JSON.stringify({ stage })),
    JSON.stringify({ done: true, tier, filename, html: "<html></html>" }),
  ];
  const encoded = new TextEncoder().encode(`${lines.join("\n")}\n`);

  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Report-Tier": tier,
    }),
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: () =>
            Promise.resolve(
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: encoded }),
            ),
        };
      },
    },
  };
}

function rejectedResponse() {
  return {
    ok: false,
    status: 500,
    headers: new Headers(),
    json: () => Promise.resolve({ message: "boom" }),
  };
}

/** Two rows off one hook, exactly as the run history panel wires them. */
function ReportRows({
  batchRunIds,
  onToggle,
  projectId = "project_1",
}: {
  batchRunIds: string[];
  onToggle?: (batchRunId: string) => void;
  projectId?: string;
}) {
  const { startReport, cancelReport, isReportRunning } = useBatchRunReport({
    projectId,
  });

  return (
    <>
      {batchRunIds.map((batchRunId) => (
        <RunRow
          key={batchRunId}
          batchRun={makeBatchRun({ batchRunId })}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={() => onToggle?.(batchRunId)}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          suiteName={`Suite ${batchRunId}`}
          onExportReport={() =>
            startReport({
              batchRunId,
              scenarioSetId: "set_1",
              suiteName: `Suite ${batchRunId}`,
              withAnalysis: false,
            })
          }
          onExportReportWithLangy={() =>
            startReport({
              batchRunId,
              scenarioSetId: "set_1",
              suiteName: `Suite ${batchRunId}`,
              withAnalysis: true,
            })
          }
          onCancelReport={() => cancelReport({ batchRunId })}
          isReportRunning={isReportRunning(batchRunId)}
        />
      ))}
    </>
  );
}

async function openReportMenu({
  user,
  batchRunId,
}: {
  user: ReturnType<typeof userEvent.setup>;
  batchRunId: string;
}) {
  await user.click(
    screen.getByRole("button", { name: `Actions for Suite ${batchRunId}` }),
  );
  return screen.getByTestId("export-report-menu-item");
}

function rowOf(batchRunId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-batch-id="${batchRunId}"]`,
  );
  if (!row) throw new Error(`No row rendered for ${batchRunId}`);
  return row;
}

/**
 * Captures downloads instead of performing them.
 *
 * jsdom has no download machinery, and the hook's last act is an anchor click,
 * so intercepting that click is the only place the filename it chose can be
 * observed.
 */
function captureDownloads() {
  vi.stubGlobal("URL", {
    ...window.URL,
    createObjectURL: vi.fn(() => "blob:report"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadedFilenames.push(this.getAttribute("download"));
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  pendingRequests.length = 0;
  downloadedFilenames.length = 0;
  installFetchMock();
  captureDownloads();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("run report action on a run history row", () => {
  describe("given a run in the history", () => {
    /** @scenario "Every run offers a report" */
    it("offers both an instant export and one with Langy", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });

      expect(item).toHaveTextContent("Instant export");
      expect(
        screen.getByTestId("export-report-langy-menu-item"),
      ).toHaveTextContent("Export with Langy");
    });

    /** @scenario "I am told what the report will cover before I wait for it" */
    it("names how many scenarios the report covers before it is asked for", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      expect(item).toHaveTextContent("2 scenarios");
      expect(pendingRequests).toHaveLength(0);
    });
  });

  describe("when the action is clicked", () => {
    /** @scenario "Exporting a report leaves the run history alone" */
    it("does not expand or collapse the row", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      render(<ReportRows batchRunIds={["batch_a"]} onToggle={onToggle} />, {
        wrapper: Wrapper,
      });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      await user.click(item);

      await waitFor(() => expect(pendingRequests).toHaveLength(1));
      expect(onToggle).not.toHaveBeenCalled();
    });

    /** @scenario "Exporting a report leaves the run history alone" */
    it("keeps the actions trigger a sibling of the expand control, not a nested one", () => {
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      // A control inside a button is invalid HTML: the parser closes the outer
      // button early, and assistive technology treats everything inside a
      // button as part of its label, so the trigger disappears entirely.
      const trigger = screen.getByRole("button", {
        name: "Actions for Suite batch_a",
      });
      expect(trigger.tagName.toLowerCase()).toBe("button");

      const header = screen.getAllByTestId("run-row-header")[0]!;
      expect(header.tagName.toLowerCase()).not.toBe("button");
      for (const button of header.querySelectorAll("button")) {
        expect(button.querySelectorAll("button")).toHaveLength(0);
      }
    });

    /** @scenario "The report covers the run I asked for" */
    it("asks for a report scoped to that row's run", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a", "batch_b"]} />, {
        wrapper: Wrapper,
      });

      const item = await openReportMenu({ user, batchRunId: "batch_b" });
      await user.click(item);

      await waitFor(() => expect(pendingRequests).toHaveLength(1));
      expect(pendingRequests[0]!.url).toBe(
        "/api/export/batch-run-report/download?stream=1",
      );
      expect(pendingRequests[0]!.body).toEqual({
        projectId: "project_1",
        scenarioSetId: "set_1",
        batchRunId: "batch_b",
        withAnalysis: false,
      });
    });
  });
});

describe("run report action results", () => {
  describe("when the report comes back", () => {
    /** @scenario "The file downloads with a descriptive name" */
    it("downloads the file under the name the server chose", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      await user.click(item);
      await waitFor(() => expect(pendingRequests).toHaveLength(1));

      pendingRequests[0]!.resolve(
        reportResponse({ filename: "checkout-suite-report.html" }),
      );

      await waitFor(() =>
        expect(downloadedFilenames).toEqual(["checkout-suite-report.html"]),
      );
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
    });

    /** @scenario "A report still downloads when no model is configured" */
    it("says the written analysis is missing when only the figures came back", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      await user.click(item);
      await waitFor(() => expect(pendingRequests).toHaveLength(1));

      pendingRequests[0]!.resolve(reportResponse({ tier: "figures_only" }));

      await waitFor(() => expect(downloadedFilenames).toHaveLength(1));
      await waitFor(() => expect(toasterCreateMock).toHaveBeenCalledOnce());
      expect(toasterCreateMock.mock.calls[0]![0]).toMatchObject({
        type: "info",
      });
    });

    // No scenario in the feature file covers a rejected request — the feature
    // is written from the reader's side, where the file always arrives. This
    // guards the client half of that promise: a rejection is said out loud
    // rather than leaving a row spinning at nothing.
    it("raises an error and downloads nothing when the request is rejected", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      await user.click(item);
      await waitFor(() => expect(pendingRequests).toHaveLength(1));

      pendingRequests[0]!.resolve(rejectedResponse());

      await waitFor(() => expect(showErrorToastMock).toHaveBeenCalledOnce());
      expect(downloadedFilenames).toHaveLength(0);
      await waitFor(() =>
        expect(
          within(rowOf("batch_a")).queryByTestId("cancel-report-button"),
        ).not.toBeInTheDocument(),
      );
    });
  });

  /**
   * The stream is a line protocol over a connection that can be cut at any
   * point, including between the document and the end of the response.
   */
  describe("when the stream does not end cleanly", () => {
    /** @scenario "A cut connection does not report a failure over a delivered file" */
    it("keeps the delivered file and says nothing when the last line is truncated", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      await user.click(item);
      await waitFor(() => expect(pendingRequests).toHaveLength(1));

      // The document arrives whole; the connection is then cut mid-line.
      pendingRequests[0]!.resolve(
        truncatedAfterDocumentResponse({ filename: "delivered.html" }),
      );

      await waitFor(() =>
        expect(downloadedFilenames).toEqual(["delivered.html"]),
      );
      expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    it("surfaces a mid-stream failure by its code rather than a sentence", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a"]} />, { wrapper: Wrapper });

      const item = await openReportMenu({ user, batchRunId: "batch_a" });
      await user.click(item);
      await waitFor(() => expect(pendingRequests).toHaveLength(1));

      pendingRequests[0]!.resolve(
        streamFailureResponse("scenario_batch_run_not_found"),
      );

      await waitFor(() => expect(showErrorToastMock).toHaveBeenCalledOnce());
      expect(downloadedFilenames).toHaveLength(0);
      // The code rides on the error so the toast renders the words written for
      // it rather than the generic fallback.
      expect(showErrorToastMock.mock.calls[0]![0].error).toMatchObject({
        error: "scenario_batch_run_not_found",
      });
    });
  });
});

describe("run report action concurrency", () => {
  describe("when two rows are asked for a report", () => {
    /** @scenario "Two reports can be produced at once" */
    it("keeps both in flight, each row showing its own state", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a", "batch_b"]} />, {
        wrapper: Wrapper,
      });

      await user.click(await openReportMenu({ user, batchRunId: "batch_a" }));
      await waitFor(() =>
        expect(
          within(rowOf("batch_a")).getByTestId("cancel-report-button"),
        ).toBeInTheDocument(),
      );
      expect(
        within(rowOf("batch_b")).queryByTestId("cancel-report-button"),
      ).not.toBeInTheDocument();

      await user.click(await openReportMenu({ user, batchRunId: "batch_b" }));
      await waitFor(() => expect(pendingRequests).toHaveLength(2));

      expect(
        within(rowOf("batch_a")).getByTestId("cancel-report-button"),
      ).toBeInTheDocument();
      expect(
        within(rowOf("batch_b")).getByTestId("cancel-report-button"),
      ).toBeInTheDocument();
      expect(pendingRequests[0]!.signal.aborted).toBe(false);
      expect(pendingRequests[1]!.signal.aborted).toBe(false);

      // Finishing the second leaves the first running.
      pendingRequests[1]!.resolve(reportResponse({ filename: "b.html" }));
      await waitFor(() => expect(downloadedFilenames).toEqual(["b.html"]));
      expect(
        within(rowOf("batch_a")).getByTestId("cancel-report-button"),
      ).toBeInTheDocument();
    });
  });

  describe("when a report in progress is cancelled", () => {
    /** @scenario "Cancelling a report in progress stops it" */
    it("stops that report and downloads nothing", async () => {
      const user = userEvent.setup();
      render(<ReportRows batchRunIds={["batch_a", "batch_b"]} />, {
        wrapper: Wrapper,
      });

      await user.click(await openReportMenu({ user, batchRunId: "batch_a" }));
      await user.click(await openReportMenu({ user, batchRunId: "batch_b" }));
      await waitFor(() => expect(pendingRequests).toHaveLength(2));

      await user.click(
        within(rowOf("batch_a")).getByTestId("cancel-report-button"),
      );

      await waitFor(() =>
        expect(
          within(rowOf("batch_a")).queryByTestId("cancel-report-button"),
        ).not.toBeInTheDocument(),
      );
      expect(pendingRequests[0]!.signal.aborted).toBe(true);
      expect(pendingRequests[1]!.signal.aborted).toBe(false);
      expect(downloadedFilenames).toHaveLength(0);
      expect(showErrorToastMock).not.toHaveBeenCalled();
    });
  });
});
