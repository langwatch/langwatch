import { createLogger } from "@langwatch/observability";

import {
  type CancellationPublisher as CancellationPublisherPort,
  type CancellationSubscriber as CancellationSubscriberPort,
  type CancellationMessage,
} from "../../app/scenario.app.ts";

export const CANCELLATION_CHANNEL = "scenario:cancel";

export type CancellationPublisherClient = {
  publish: (channel: string, message: string) => Promise<number>;
};

export type CancellationSubscriberClient = {
  subscribe: (channel: string) => Promise<unknown>;
  on: (event: "message", handler: (channel: string, message: string) => void) => void;
  quit: () => Promise<unknown>;
};

const logger = createLogger("langwatch:scenarios:cancellation-channel");

export class RedisScenarioCancellationPublisherChannel implements CancellationPublisherPort {
  static create(publisher: CancellationPublisherClient): RedisScenarioCancellationPublisherChannel {
    return new RedisScenarioCancellationPublisherChannel(publisher);
  }

  private constructor(private readonly publisher: CancellationPublisherClient) {}

  async publish(message: CancellationMessage): Promise<void> {
    await this.publisher.publish(CANCELLATION_CHANNEL, JSON.stringify(message));
    logger.debug(
      { scenarioRunId: message.scenarioRunId, batchRunId: message.batchRunId },
      "Cancellation published",
    );
  }
}

export class UnavailableCancellationPublisherAdapter implements CancellationPublisherPort {
  static create(): UnavailableCancellationPublisherAdapter {
    return new UnavailableCancellationPublisherAdapter();
  }

  private constructor() {}

  publish(message: CancellationMessage): Promise<void> {
    return Promise.reject(
      new Error(`Cancellation transport unavailable for scenarioRunId=${message.scenarioRunId}`),
    );
  }
}

export class RedisScenarioCancellationSubscriberChannel implements CancellationSubscriberPort {
  static create(
    subscriber: CancellationSubscriberClient,
  ): RedisScenarioCancellationSubscriberChannel {
    return new RedisScenarioCancellationSubscriberChannel(subscriber);
  }

  private constructor(private readonly subscriber: CancellationSubscriberClient) {}

  async subscribe(
    onCancellation: (message: CancellationMessage) => void,
  ): Promise<() => Promise<void>> {
    await this.subscriber.subscribe(CANCELLATION_CHANNEL);
    this.subscriber.on("message", (channel, raw) => {
      if (channel !== CANCELLATION_CHANNEL) return;

      const message = this.parseMessage(raw);
      if (message) onCancellation(message);
    });

    return async () => {
      await this.subscriber.quit();
    };
  }

  private parseMessage(raw: string): CancellationMessage | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!this.isCancellationMessage(parsed)) {
        logger.warn({ raw }, "Received malformed cancellation message, ignoring");
        return null;
      }
      return parsed;
    } catch {
      logger.warn({ raw }, "Received malformed cancellation message, ignoring");
      return null;
    }
  }

  private isCancellationMessage(value: unknown): value is CancellationMessage {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.projectId === "string" &&
      typeof record.scenarioRunId === "string" &&
      (!Object.hasOwn(record, "batchRunId") ||
        record.batchRunId === undefined ||
        typeof record.batchRunId === "string")
    );
  }
}

/**
 * A dedicated connection, opened on first subscribe: a client in subscribe mode
 * can issue nothing else, and a process that never consumes never opens one.
 */
export class DuplicatedCancellationConnection implements CancellationSubscriberClient {
  #connection: CancellationSubscriberClient | undefined;

  private constructor(private readonly source: { duplicate(): CancellationSubscriberClient }) {}

  static over(source: {
    duplicate(): CancellationSubscriberClient;
  }): DuplicatedCancellationConnection {
    return new DuplicatedCancellationConnection(source);
  }

  subscribe(channel: string): Promise<unknown> {
    return this.#opened().subscribe(channel);
  }

  on(event: "message", handler: (channel: string, message: string) => void): void {
    this.#opened().on(event, handler);
  }

  async quit(): Promise<unknown> {
    return this.#connection?.quit();
  }

  #opened(): CancellationSubscriberClient {
    this.#connection ??= this.source.duplicate();
    return this.#connection;
  }
}
