import { createLogger } from "@langwatch/observability";
import {
  CancellationPublisherPort,
  CancellationSubscriberPort,
  type CancellationMessage,
} from "../ports/cancellation-channel.port";

export const CANCELLATION_CHANNEL = "scenario:cancel";

export type CancellationPublisher = {
  publish(channel: string, message: string): Promise<number>;
};

export type CancellationSubscriber = {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", handler: (channel: string, message: string) => void): void;
  quit(): Promise<unknown>;
};

const logger = createLogger("langwatch:scenarios:cancellation-channel");

export class RedisCancellationPublisherAdapter extends CancellationPublisherPort {
  static create(publisher: CancellationPublisher): RedisCancellationPublisherAdapter {
    return new RedisCancellationPublisherAdapter(publisher);
  }

  private constructor(private readonly publisher: CancellationPublisher) {
    super();
  }

  async publish(message: CancellationMessage): Promise<void> {
    await this.publisher.publish(CANCELLATION_CHANNEL, JSON.stringify(message));
    logger.debug(
      { scenarioRunId: message.scenarioRunId, batchRunId: message.batchRunId },
      "Cancellation published",
    );
  }
}

export class UnavailableCancellationPublisherAdapter extends CancellationPublisherPort {
  static create(): UnavailableCancellationPublisherAdapter {
    return new UnavailableCancellationPublisherAdapter();
  }

  private constructor() {
    super();
  }

  publish(message: CancellationMessage): Promise<void> {
    return Promise.reject(
      new Error(`Cancellation transport unavailable for scenarioRunId=${message.scenarioRunId}`),
    );
  }
}

export class RedisCancellationSubscriberAdapter extends CancellationSubscriberPort {
  static create(subscriber: CancellationSubscriber): RedisCancellationSubscriberAdapter {
    return new RedisCancellationSubscriberAdapter(subscriber);
  }

  private constructor(private readonly subscriber: CancellationSubscriber) {
    super();
  }

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
