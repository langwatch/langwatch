/**
 * The run-state half of a streaming execution.
 *
 * A run started by an open tab used to exist only inside that tab, so
 * `GET /runs/:runId` answered 404 for it and `langwatch experiment status`
 * could not follow a run it had just started. The store is Redis, so a poll
 * served by a different process finds the run too.
 *
 * This lives beside the runner rather than in the route, so the route stays
 * request handling and stream output and the run's lifecycle stays with the
 * execution layer that owns it.
 */

import type { SerializedHandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { EvaluationV3Event } from "@langwatch/experiment-contract";
import type { ExperimentRunProgressPort } from "../ports/experiment-run-progress.port";

const logger = createLogger("langwatch:experiment:run-state-mirror");

/** What a caller feeds one run's stream into. */
export interface RunStateMirror {
  /** Record one frame. The first `execution_started` frame opens the run. */
  record(event: EvaluationV3Event): Promise<void>;
  /**
   * Record that the run died before it reported how it ended.
   *
   * Not written once the run has reported that, since a write after the last
   * frame would rewrite a finished run as a failed one.
   */
  fail(failure: {
    code: string;
    domainError?: SerializedHandledError;
    traceId?: string;
  }): Promise<void>;
}

/** Opens a mirror for one run of one experiment. */
export class ExperimentRunStateMirrorService implements RunStateMirror {
  private runId: string | undefined;
  private ended = false;

  private constructor(
    private readonly projectId: string,
    private readonly experimentId: string | undefined,
    private readonly experimentSlug: string,
    private readonly progress: ExperimentRunProgressPort,
  ) {}

  static create(options: {
    projectId: string;
    experimentId?: string;
    experimentSlug: string;
    /** Where the frames are mirrored so a poll on another process finds them. */
    progress: ExperimentRunProgressPort;
  }): ExperimentRunStateMirrorService {
    return new ExperimentRunStateMirrorService(
      options.projectId,
      options.experimentId,
      options.experimentSlug,
      options.progress,
    );
  }

  async record(event: EvaluationV3Event): Promise<void> {
    if (event.type === "execution_started") {
      this.runId = event.runId;
      await this.mirrored("createRun", () =>
        this.progress.createRun({
          runId: event.runId,
          projectId: this.projectId,
          experimentId: this.experimentId,
          experimentSlug: this.experimentSlug,
          total: event.total,
        }),
      );

      return;
    }

    const id = this.runId;
    if (!id) {
      return;
    }

    await this.mirrored("addEvent", () => this.progress.addEvent(id, event));
    await this.recordEnd(event);
  }

  async fail(failure: {
    code: string;
    domainError?: SerializedHandledError;
    traceId?: string;
  }): Promise<void> {
    const id = this.runId;
    if (!id || this.ended) {
      return;
    }

    await this.mirrored("failRun", () => this.progress.failRun(id, failure));
  }

  private async recordEnd(event: EvaluationV3Event): Promise<void> {
    const id = this.runId;
    if (!id) {
      return;
    }

    if (event.type === "done") {
      this.ended = true;
      await this.mirrored("completeRun", () => this.progress.completeRun(id, event.summary));

      return;
    }

    if (event.type === "stopped") {
      this.ended = true;
      await this.mirrored("stopRun", () => this.progress.stopRun(id));
    }
  }

  /**
   * The mirror never fails the run it is watching.
   *
   * The store is Redis and it is a side channel for pollers, so a timeout on it
   * must not reach the `for await` loop the run is streaming through: that
   * would write an error frame to the customer and abandon a healthy run.
   */
  private async mirrored(what: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      logger.warn(
        { error, projectId: this.projectId, runId: this.runId, what },
        "run-state mirror write failed; the run itself is unaffected",
      );
    }
  }
}
