import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

import { CliDeviceSettlementChannel } from "../cli-device-settlement.channel.ts";

const logger = createLogger("langwatch:auth-cli");

const CHANNEL_PREFIX = "lwcli:device-settled:";

function channelFor(deviceCode: string): string {
  return `${CHANNEL_PREFIX}${deviceCode}`;
}

/**
 * Redis pub/sub. A subscribing connection can run nothing else, so every open
 * stream on this pod shares one dedicated connection, opened on first listen.
 */
export class RedisCliDeviceSettlementChannel extends CliDeviceSettlementChannel {
  readonly #redis: RedisConnection;
  readonly #listeners = new Map<string, Set<(status: string) => void>>();
  #subscriber: RedisConnection | undefined;

  private constructor(redis: RedisConnection) {
    super();
    this.#redis = redis;
  }

  static create(redis: RedisConnection): RedisCliDeviceSettlementChannel {
    return new RedisCliDeviceSettlementChannel(redis);
  }

  async publish({ deviceCode, status }: { deviceCode: string; status: string }): Promise<void> {
    try {
      await this.#redis.publish(channelFor(deviceCode), status);
    } catch (error) {
      logger.debug(
        { error },
        "[auth-cli] could not publish the device-code settlement; the CLI's own poll still settles the login",
      );
    }
  }

  async listen({
    deviceCode,
    onSettled,
  }: {
    deviceCode: string;
    onSettled: (status: string) => void;
  }): Promise<() => void> {
    const channel = channelFor(deviceCode);
    const listeners = this.#listeners.get(channel) ?? new Set();
    listeners.add(onSettled);
    this.#listeners.set(channel, listeners);

    const release = () => {
      listeners.delete(onSettled);
      if (listeners.size > 0 || this.#listeners.get(channel) !== listeners) return;
      this.#listeners.delete(channel);
      // An unsubscribe that fails leaves a channel nothing listens on.
      void this.#subscriber?.unsubscribe(channel).catch(() => undefined);
    };

    try {
      await this.#openSubscriber().subscribe(channel);
    } catch (error) {
      release();
      throw error;
    }

    return release;
  }

  #openSubscriber(): RedisConnection {
    if (this.#subscriber) return this.#subscriber;

    const subscriber = this.#redis.duplicate();
    subscriber.on("message", (channel: string, message: string) => {
      for (const listener of this.#listeners.get(channel) ?? []) listener(message);
    });
    subscriber.on("error", (error: Error) => {
      logger.debug(
        { error: error.message },
        "[auth-cli] device-approval subscriber error; the CLI's own poll still settles the login",
      );
    });
    this.#subscriber = subscriber;

    return subscriber;
  }
}
