/**
 * The workbench page's run half: clicks a column's own run button and reads the
 * `POST /api/experiments/execute` stream the page itself posted, once it closes.
 */
import type { EvaluationV3Event } from "@langwatch/experiment-contract";
import type { Page } from "playwright";

/** How long one run's stream may take, from the click to its terminal frame. */
const RUN_TIMEOUT_MS = 600_000;

/** One run the page started, with everything its stream said. */
export interface WorkbenchPageRun {
  runId?: string;
  events: EvaluationV3Event[];
  status: "success" | "stopped" | "error";
  /** Set when the stream failed rather than the run reporting how it ended. */
  failure?: string;
}

/** The events one SSE frame carries, skipping anything that is not one. */
function eventsInFrame(frame: string): EvaluationV3Event[] {
  const events: EvaluationV3Event[] = [];
  for (const line of frame.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // A frame that is not JSON is not an event. The stream carries keepalives.
      continue;
    }
  }
  return events;
}

/** What a stream said so far: its run, how it ended, and a run-level failure. */
interface StreamReading {
  run: WorkbenchPageRun;
  terminal?: "success" | "stopped";
  fatal?: string;
}

function readEvent(reading: StreamReading, event: EvaluationV3Event): void {
  reading.run.events.push(event);
  if (event.type === "execution_started") reading.run.runId = event.runId;
  if (event.type === "error" && event.rowIndex === undefined) reading.fatal = event.message;
  if (event.type === "done") reading.terminal = "success";
  if (event.type === "stopped") reading.terminal = "stopped";
}

/** How a closed stream's frames land on the run the assertions read. */
export function runFromStream(body: string): WorkbenchPageRun {
  const reading: StreamReading = { run: { events: [], status: "error" } };
  for (const frame of body.split("\n\n")) {
    for (const event of eventsInFrame(frame)) readEvent(reading, event);
  }
  const { run, terminal, fatal } = reading;
  if (fatal) {
    run.failure = fatal;
  } else if (terminal) {
    run.status = terminal;
  } else {
    run.failure = "the run's stream closed without a terminal frame";
  }
  return run;
}

/** The execute streams the page posts, each handed over once the server closes it. */
export interface ExecuteStreamRecorder {
  /** The body of the next stream the page opens from now on. */
  next: () => Promise<string>;
}

/**
 * Tees the page's own `fetch` of `/api/experiments/execute`: the page stops reading at
 * its terminal frame, so the clone is what still holds the whole stream.
 */
export async function recordExecuteStreams(page: Page): Promise<ExecuteStreamRecorder> {
  const waiting: ((body: string) => void)[] = [];
  const unclaimed: string[] = [];
  await page.exposeFunction("__workbenchExecuteStream", (body: string) => {
    const resolve = waiting.shift();
    if (resolve) resolve(body);
    else unclaimed.push(body);
  });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const record = Reflect.get(window, "__workbenchExecuteStream");
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === "/api/experiments/execute" && typeof record === "function") {
        response
          .clone()
          .text()
          .then((body) => record(body))
          .catch((error: unknown) =>
            record(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`),
          );
      }
      return response;
    };
  });
  return {
    next: () =>
      new Promise<string>((resolve, reject) => {
        const body = unclaimed.shift();
        if (body !== undefined) return resolve(body);
        const timer = setTimeout(
          () => reject(new Error("the page's run stream never closed")),
          RUN_TIMEOUT_MS,
        );
        waiting.push((recorded) => {
          clearTimeout(timer);
          resolve(recorded);
        });
      }),
  };
}

/** Runs one column the way a reader does: its header's own run button. */
export async function runColumnOnPage({
  page,
  streams,
  targetId,
}: {
  page: Page;
  streams: ExecuteStreamRecorder;
  targetId: string;
}): Promise<WorkbenchPageRun> {
  const body = streams.next();
  await page.locator(`[data-target-id="${targetId}"]`).getByTestId("target-play-button").click();
  return runFromStream(await body);
}

/** How many cells of one column hold an output: only those render a copy button. */
export function filledCellsOnPage({
  page,
  targetId,
}: {
  page: Page;
  targetId: string;
}): Promise<number> {
  return page.getByTestId(`copy-output-${targetId}`).count();
}
