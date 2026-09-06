/**
 * Cross-pod signal that a device-code login has settled.
 *
 * `langwatch login --device` learned about an approval only on its next
 * `/exchange` poll, so a login the user approved in two seconds still sat on
 * the spinner for the rest of the poll interval. The request that approves or
 * denies the code publishes here, `GET /api/auth/cli/device-approval` waits on
 * it, and the CLI polls the moment the frame lands.
 *
 * Everything here is best effort. Polling stays the correctness floor, so a
 * Redis without pub/sub, a proxy that buffers the stream, or a CLI that
 * predates the route all fall back to it, and no failure in this file may
 * fail an approval.
 */

import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";

const logger = createLogger("langwatch:auth-cli");

type RedisConnection = Redis | Cluster;

const CHANNEL_PREFIX = "lwcli:device-settled:";

function channelFor(deviceCode: string): string {
  return `${CHANNEL_PREFIX}${deviceCode}`;
}

type Listener = (status: string) => void;

/**
 * One subscriber shared by every open stream on this pod. Subscriber mode
 * blocks a connection, so it cannot be the app's own, and a connection per
 * waiting CLI would scale with logins rather than with pods.
 */
let subscriber: RedisConnection | null = null;
const listeners = new Map<string, Set<Listener>>();

function ensureSubscriber(redis: RedisConnection): RedisConnection | null {
  if (subscriber) return subscriber;
  try {
    const connection = redis.duplicate();
    connection.on("message", (channel: string, message: string) => {
      for (const listener of listeners.get(channel) ?? []) listener(message);
    });
    connection.on("error", (error: Error) => {
      logger.debug(
        { error: error.message },
        "[auth-cli] device-approval subscriber error; the CLI's own poll still settles the login",
      );
    });
    subscriber = connection;
    return connection;
  } catch (error) {
    logger.debug(
      { error },
      "[auth-cli] could not open the device-approval subscriber; the CLI's own poll still settles the login",
    );
    return null;
  }
}

/** Announce that a device code reached `approved` or `denied`. */
export async function publishDeviceCodeSettled({
  redis,
  deviceCode,
  status,
}: {
  redis: RedisConnection;
  deviceCode: string;
  status: string;
}): Promise<void> {
  try {
    await redis.publish(channelFor(deviceCode), status);
  } catch (error) {
    logger.debug(
      { error },
      "[auth-cli] could not publish the device-code settlement; the CLI's own poll still settles the login",
    );
  }
}

/**
 * Watch for the status the browser publishes for this device code.
 *
 * `subscribed` resolves once the channel is live, or once it is known that it
 * never will be. It is what lets the caller re-read the record before it
 * commits to waiting: a code settled between the caller's own read and this
 * subscribe published to nobody, and Redis pub/sub keeps nothing for a late
 * subscriber.
 *
 * `settled` resolves with the published status, or with null when the signal
 * aborts first or the subscribe failed.
 */
export function waitForDeviceCodeSettled({
  redis,
  deviceCode,
  signal,
}: {
  redis: RedisConnection;
  deviceCode: string;
  /** Aborts the wait: the stream closed, or the device code ran out of time. */
  signal: AbortSignal;
}): { subscribed: Promise<void>; settled: Promise<string | null> } {
  const connection = ensureSubscriber(redis);
  if (!connection) {
    return { subscribed: Promise.resolve(), settled: Promise.resolve(null) };
  }

  const channel = channelFor(deviceCode);
  let markSubscribed: () => void = () => {
    // Replaced below, before anything can call it.
  };
  const subscribed = new Promise<void>((resolve) => {
    markSubscribed = resolve;
  });

  const settled = new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (status: string | null) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      release({ connection, channel, listener });
      markSubscribed();
      resolve(status);
    };
    const listener: Listener = (status) => finish(status);
    const onAbort = () => finish(null);

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      finish(null);
      return;
    }

    let channelListeners = listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      listeners.set(channel, channelListeners);
    }
    channelListeners.add(listener);

    connection.subscribe(channel).then(
      () => markSubscribed(),
      (error: unknown) => {
        logger.debug(
          { error },
          "[auth-cli] could not subscribe to the device-code settlement; the CLI's own poll still settles the login",
        );
        finish(null);
      },
    );
  });

  return { subscribed, settled };
}

function release({
  connection,
  channel,
  listener,
}: {
  connection: RedisConnection;
  channel: string;
  listener: Listener;
}): void {
  const channelListeners = listeners.get(channel);
  if (!channelListeners) return;
  channelListeners.delete(listener);
  if (channelListeners.size > 0) return;
  listeners.delete(channel);
  void connection.unsubscribe(channel).catch(() => {
    // An unsubscribe that fails leaves a channel nothing listens on.
  });
}

/** Drop the shared subscriber. Tests use it to release the connection. */
export async function resetDeviceApprovalSubscriber(): Promise<void> {
  const connection = subscriber;
  subscriber = null;
  listeners.clear();
  if (!connection) return;
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}
