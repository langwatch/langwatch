/**
 * The fake workbench tab's run half: posting the page's own execute request and
 * draining the stream into the store.
 *
 * Split out of `fake-workbench-tab.ts` so the tab's wiring stays readable. The
 * request is built by the app's own `buildExecutionRequest` and the frames are
 * folded by the app's own `foldEvaluationEvent`; what is stood in for is the
 * page's SSE client, which needs an origin the browser supplies.
 */
import { buildExecutionRequest } from "~/experiments-v3/execution/buildExecutionRequest";
import { foldEvaluationEvent } from "~/experiments-v3/execution/resultsFold";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import type {
  EvaluationV3Event,
  ExecutionScope,
} from "~/server/experiments-v3/execution/types";
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

/**
 * Drain one run into the store and into `runs`.
 *
 * `saveNow` is passed in rather than imported: the cells a run produces belong
 * on the server too, and the page gets there through its autosave debounce.
 */
export function createFakeTabRunner({
  cookie,
  runs,
  saveNow,
}: {
  cookie: string;
  runs: FakeTabRun[];
  saveNow: () => Promise<SaveOutcome>;
}): {
  drainRun(input: {
    scope: ExecutionScope;
    onRunStarted: (runId: string | undefined) => void;
  }): Promise<FakeTabRun>;
} {
  /**
   * The run's SSE frames, folded into the store as they arrive.
   *
   * Folding rather than ignoring the stream is what makes a candidate-only
   * comparison run possible: `buildExecutionRequest` builds `seedTargetOutputs`
   * from `results.targetOutputs`, and `workbench.getState` from a live page
   * projects results too. A tab that never folds would answer differently from
   * the page it stands in for.
   */
  const drainRun = async ({
    scope,
    onRunStarted,
  }: {
    scope: ExecutionScope;
    onRunStarted: (runId: string | undefined) => void;
  }): Promise<FakeTabRun> => {
    const run: FakeTabRun = { events: [], status: "error" };
    runs.push(run);

    const state = useEvaluationsV3Store.getState();
    const built = buildExecutionRequest({
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
    if (!built) {
      run.failure = "the workbench holds no dataset to run";
      onRunStarted(undefined);
      return run;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resetTimer = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), ms);
    };

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
        body: JSON.stringify(built.request),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        run.failure = `POST /api/experiments/execute -> ${res.status}: ${(
          await res.text()
        ).slice(0, 300)}`;
        onRunStarted(undefined);
        return run;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal: "success" | "stopped" | undefined;
      let fatal: string | undefined;

      const handleFrame = (frame: string) => {
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          let event: EvaluationV3Event;
          try {
            event = JSON.parse(payload) as EvaluationV3Event;
          } catch {
            continue;
          }
          run.events.push(event);
          if (event.type === "execution_started") {
            run.runId = event.runId;
            onRunStarted(event.runId);
          }
          if (event.type === "error" && event.rowIndex === undefined) {
            fatal = event.message;
          }
          if (event.type === "done") terminal = "success";
          if (event.type === "stopped") terminal = "stopped";
          useEvaluationsV3Store.setState((current) => ({
            results: foldEvaluationEvent({
              results: current.results,
              event,
              evaluatorIds: current.evaluators.map((evaluator) => evaluator.id),
            }),
          }));
        }
      };

      while (true) {
        resetTimer(RUN_CHUNK_TIMEOUT_MS);
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          handleFrame(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
        }
        if (terminal) break;
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);

      if (fatal) {
        run.status = "error";
        run.failure = fatal;
      } else if (terminal) {
        run.status = terminal;
      } else {
        run.status = "error";
        run.failure = "the run's stream closed without a terminal frame";
      }
    } catch (error) {
      run.status = "error";
      run.failure = String(error).slice(0, 300);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      onRunStarted(undefined);
    }

    // The cells the run produced belong on the server too. The real page gets
    // there through the autosave debounce; this tab saves once, here.
    await saveNow();
    return run;
  };

  return { drainRun };
}
