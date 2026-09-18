import { foldEvaluationEvent } from "@langwatch/experiment-browser/workbench-results-fold";
import { useEvaluationsV3Store } from "@langwatch/experiment-browser/workbench-store";
/**
 * The fake workbench tab's run half: posts the page's execute request and
 * drains the stream into the store, standing in for the page's SSE client,
 * which needs an origin the browser supplies.
 */
import { buildExecutionRequest } from "@langwatch/experiment-contract";
import type {
  EvaluationV3Event,
  ExecutionRequest,
  ExecutionScope,
} from "@langwatch/experiment-contract";

import { APP_BASE, PROJECT_ID } from "./config";
import type { SaveOutcome } from "./fake-tab-document";

/** How long a run's stream may go without a frame before it is abandoned. */
const RUN_CHUNK_TIMEOUT_MS = 300_000;

/** How long the run's stream may take to open. */
const RUN_CONNECT_TIMEOUT_MS = 60_000;

/** One run this tab started, with everything its stream said. */
export interface FakeTabRun {
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
      events.push(JSON.parse(payload) as EvaluationV3Event);
    } catch {
      // A frame that is not JSON is not an event. The stream carries keepalives.
      continue;
    }
  }
  return events;
}

/**
 * Folds one event into the store, the way the page's results hook does —
 * `buildExecutionRequest` and `workbench.getState` both read projected
 * results, so a tab that never folds would answer differently.
 */
function foldIntoStore(event: EvaluationV3Event): void {
  useEvaluationsV3Store.setState((current) => ({
    results: foldEvaluationEvent({
      results: current.results,
      event,
      evaluatorIds: current.evaluators.map((evaluator) => evaluator.id),
    }),
  }));
}

/** The execute request this run posts, or the reason there is none. */
function requestForScope(scope: ExecutionScope) {
  const state = useEvaluationsV3Store.getState();
  return buildExecutionRequest({
    state: {
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      targets: state.targets,
      evaluators: state.evaluators,
      experimentId: state.experimentId ?? undefined,
      experimentSlug: state.experimentSlug ?? undefined,
      results: state.results,
    },
    projectId: PROJECT_ID,
    scope,
    concurrency: state.ui.concurrency,
  });
}

/** What one run's stream said, once it closed. */
type StreamOutcome = {
  /** How the run reported it ended, when it did. */
  terminal?: "success" | "stopped";
  /** A run-level error frame: the run itself failed. */
  fatal?: string;
  /** The stream never delivered a run: the request or the transport failed. */
  failure?: string;
};

function applyRunFrame(
  frame: string,
  outcome: StreamOutcome,
  onEvent: (event: EvaluationV3Event) => void,
): void {
  for (const event of eventsInFrame(frame)) {
    onEvent(event);
    if (event.type === "error" && event.rowIndex === undefined) {
      outcome.fatal = event.message;
    }
    if (event.type === "done") outcome.terminal = "success";
    if (event.type === "stopped") outcome.terminal = "stopped";
  }
}

/**
 * Posts the execute request and reads the stream to its end, standing in
 * for the page's own `fetchSSE` (which needs a browser-supplied origin).
 * Every event still goes to `onEvent` in arrival order.
 */
async function streamRunEvents({
  cookie,
  request,
  onEvent,
}: {
  cookie: string;
  request: ExecutionRequest;
  onEvent: (event: EvaluationV3Event) => void;
}): Promise<StreamOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimer = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };

  const outcome: StreamOutcome = {};
  try {
    resetTimer(RUN_CONNECT_TIMEOUT_MS);
    const res = await fetch(`${APP_BASE}/api/experiments/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Cookie: cookie,
        Origin: APP_BASE,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      outcome.failure = `POST /api/experiments/execute -> ${res.status}: ${(await res.text()).slice(
        0,
        300,
      )}`;
      return outcome;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      resetTimer(RUN_CHUNK_TIMEOUT_MS);
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        applyRunFrame(buffer.slice(0, index), outcome, onEvent);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
      if (outcome.terminal) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) applyRunFrame(buffer, outcome, onEvent);
  } catch (error) {
    outcome.failure = String(error).slice(0, 300);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
  return outcome;
}

/** How the stream's outcome lands on the run the assertions read. */
function settleRun({ run, outcome }: { run: FakeTabRun; outcome: StreamOutcome }): void {
  const failure = outcome.failure ?? outcome.fatal;
  if (failure) {
    run.status = "error";
    run.failure = failure;
    return;
  }
  if (outcome.terminal) {
    run.status = outcome.terminal;
    return;
  }
  run.status = "error";
  run.failure = "the run's stream closed without a terminal frame";
}

export function createFakeTabRunner({
  cookie,
  runs,
  saveNow,
}: {
  cookie: string;
  runs: FakeTabRun[];
  saveNow: () => Promise<SaveOutcome>;
}): {
  drainRun: (input: {
    scope: ExecutionScope;
    onRunStarted: (runId: string | undefined) => void;
  }) => Promise<FakeTabRun>;
} {
  const drainRun = async ({
    scope,
    onRunStarted,
  }: {
    scope: ExecutionScope;
    onRunStarted: (runId: string | undefined) => void;
  }): Promise<FakeTabRun> => {
    const run: FakeTabRun = { events: [], status: "error" };
    runs.push(run);

    const built = requestForScope(scope);
    if (!built) {
      run.failure = "the workbench holds no dataset to run";
      onRunStarted(undefined);
      return run;
    }

    const outcome = await streamRunEvents({
      cookie,
      request: built.request,
      onEvent: (event) => {
        run.events.push(event);
        if (event.type === "execution_started") {
          run.runId = event.runId;
          onRunStarted(event.runId);
        }
        foldIntoStore(event);
      },
    });
    // Whatever happened, the action is answered: a run the caller cannot name
    // is still a run that is going.
    onRunStarted(undefined);
    settleRun({ run, outcome });

    // The cells the run produced belong on the server too. The real page gets
    // there through the autosave debounce; this tab saves once, here.
    await saveNow();
    return run;
  };

  return { drainRun };
}
