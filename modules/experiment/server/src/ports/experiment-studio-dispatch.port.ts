import type {
  StudioClientEvent,
  StudioServerEvent,
  WorkflowRunOrigin,
} from "@langwatch/workflow-contract";

/**
 * How the workbench run reaches the studio engine.
 *
 * The run loop composes a studio event per cell and watches the frames come
 * back; who dials the engine, which model providers it strips parameters for
 * and which NLP runtime carries the stream are all facts of the process, not of
 * the run. The retired application threaded an `nlpLambda` runtime and a
 * `ModelProviderService` through nine call sites to reach one function; both
 * were pass-through, so both are behind this instead.
 *
 * A stream failure is reported to the caller AS a studio event rather than
 * thrown — a run is watched, not awaited, and a rejected promise would leave a
 * lit node and a Stop button exactly as they were.
 */
export abstract class ExperimentStudioDispatchPort {
  abstract postEvent(input: {
    projectId: string;
    event: StudioClientEvent;
    onEvent: (event: StudioServerEvent) => void;
    /** Asked before and during every read; absent means the run cannot be stopped. */
    isAborted?: () => Promise<boolean>;
    origin?: WorkflowRunOrigin;
  }): Promise<void>;
}
