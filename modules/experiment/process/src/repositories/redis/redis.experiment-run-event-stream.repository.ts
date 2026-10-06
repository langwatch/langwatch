import { createLogger } from "@langwatch/observability";

import {
  ExperimentRunEventStreamRepository,
  type ExperimentRunStreamMessage,
  type ExperimentRunStreamUnsubscribe,
  experimentRunStreamMessageSchema,
} from "../experiment-run-event-stream.repository.ts";

/** The connection a subscription holds; a `Redis`, a `Cluster` and a double all satisfy it. */
export type ExperimentRunStreamSubscriberClient = {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", handler: (channel: string, message: string) => void): unknown;
  on(event: "error", handler: (error: unknown) => void): unknown;
  disconnect(): void;
};

/** The Redis operations the stream needs: publish, and a second connection to listen on. */
export type ExperimentRunStreamRedis = Readonly<{
  publish(channel: string, message: string): Promise<number>;
  duplicate(): ExperimentRunStreamSubscriberClient;
}>;

type Listener = (message: ExperimentRunStreamMessage) => void;

const logger = createLogger("langwatch:experiment:run-event-stream");

/**
 * Redis pub/sub on `experiment_run:<runId>`. A subscribing connection can run no other command,
 * so listening opens one dedicated connection, lazily, shared by every run this process streams.
 */
export class RedisExperimentRunEventStreamRepository extends ExperimentRunEventStreamRepository {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #subscriptions = new Map<string, Promise<unknown>>();
  #subscriber: ExperimentRunStreamSubscriberClient | undefined;

  private constructor(private readonly redis: ExperimentRunStreamRedis) {
    super();
  }

  static create({
    redis,
  }: {
    redis: ExperimentRunStreamRedis;
  }): RedisExperimentRunEventStreamRepository {
    return new RedisExperimentRunEventStreamRepository(redis);
  }

  async publish({
    runId,
    seq,
    frame,
  }: { runId: string } & ExperimentRunStreamMessage): Promise<void> {
    await this.redis.publish(
      ExperimentRunEventStreamRepository.channelFor(runId),
      JSON.stringify({ seq, frame }),
    );
  }

  async subscribe({
    runId,
    onMessage,
  }: {
    runId: string;
    onMessage: Listener;
  }): Promise<ExperimentRunStreamUnsubscribe> {
    const channel = ExperimentRunEventStreamRepository.channelFor(runId);
    const listeners = this.#listeners.get(channel) ?? new Set<Listener>();
    listeners.add(onMessage);
    this.#listeners.set(channel, listeners);

    const subscription = this.#subscriptions.get(channel) ?? this.#opened().subscribe(channel);
    this.#subscriptions.set(channel, subscription);
    try {
      await subscription;
    } catch (error) {
      await this.#forget({ channel, listeners, onMessage });
      throw error;
    }
    return () => this.#forget({ channel, listeners, onMessage });
  }

  close(): void {
    this.#listeners.clear();
    this.#subscriptions.clear();
    this.#subscriber?.disconnect();
    this.#subscriber = undefined;
  }

  async #forget({
    channel,
    listeners,
    onMessage,
  }: {
    channel: string;
    listeners: Set<Listener>;
    onMessage: Listener;
  }): Promise<void> {
    listeners.delete(onMessage);
    if (listeners.size > 0 || this.#listeners.get(channel) !== listeners) return;

    this.#listeners.delete(channel);
    this.#subscriptions.delete(channel);
    await this.#subscriber?.unsubscribe(channel).catch((error: unknown) => {
      logger.warn({ channel, error }, "Could not unsubscribe from a run's event stream");
    });
  }

  #opened(): ExperimentRunStreamSubscriberClient {
    if (this.#subscriber) return this.#subscriber;

    const subscriber = this.redis.duplicate();
    subscriber.on("message", (channel, raw) => this.#deliver({ channel, raw }));
    subscriber.on("error", (error) => {
      logger.error({ error }, "The run event stream's subscriber connection failed");
    });
    this.#subscriber = subscriber;
    return subscriber;
  }

  #deliver({ channel, raw }: { channel: string; raw: string }): void {
    const listeners = this.#listeners.get(channel);
    if (!listeners) return;

    const message = this.#parse(raw);
    if (!message) {
      logger.warn({ channel }, "Dropped a malformed frame on a run's event stream");
      return;
    }
    for (const listener of listeners) listener(message);
  }

  #parse(raw: string): ExperimentRunStreamMessage | undefined {
    try {
      const parsed = experimentRunStreamMessageSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}
