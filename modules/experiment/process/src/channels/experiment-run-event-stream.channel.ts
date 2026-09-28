/**
 * A run's frames on their way from the worker that recorded them to the api process holding the
 * run's open stream. Design: specs/experiment-run-execution.md section 7.
 */
import type { EvaluationV3Event } from "@langwatch/experiment-contract";
import { z } from "zod";

/** One published frame and its place in the run's stream, so a reconnect resumes after it. */
export const experimentRunStreamMessageSchema = z.object({
  seq: z.number().int().nonnegative(),
  frame: z.custom<EvaluationV3Event>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      typeof value.type === "string",
  ),
});

export type ExperimentRunStreamMessage = z.infer<typeof experimentRunStreamMessageSchema>;

/** Stops hearing one subscription; the others on the same run keep hearing it. */
export type ExperimentRunStreamUnsubscribe = () => Promise<void>;

export abstract class ExperimentRunEventStream {
  /** The pub/sub channel a run's frames travel on. */
  static channelFor(runId: string): string {
    return `experiment_run:${runId}`;
  }

  abstract publish(input: { runId: string } & ExperimentRunStreamMessage): Promise<void>;

  /** Hears each frame published for the run from now on; earlier ones are the fold's to replay. */
  abstract subscribe(input: {
    runId: string;
    onMessage: (message: ExperimentRunStreamMessage) => void;
  }): Promise<ExperimentRunStreamUnsubscribe>;

  abstract close(): void;
}
