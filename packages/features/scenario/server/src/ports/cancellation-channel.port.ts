/** Payload broadcast when a queued or running scenario must be cancelled. */
export type CancellationMessage = {
  projectId: string;
  scenarioRunId: string;
  batchRunId?: string;
};

/** Publishes a cancellation signal to the worker fleet. */
export abstract class CancellationPublisherPort {
  abstract publish(message: CancellationMessage): Promise<void>;
}

/** Receives cancellation signals sent to the worker fleet. */
export abstract class CancellationSubscriberPort {
  abstract subscribe(
    onCancellation: (message: CancellationMessage) => void,
  ): Promise<() => Promise<void>>;
}
