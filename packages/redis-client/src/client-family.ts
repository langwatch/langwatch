import IORedis, { Cluster, type RedisOptions } from "ioredis";

import type { RedisConnection } from "./types.ts";

/** ioredis's own default backoff, kept for every attempt before shutdown. */
const reconnectDelayMs = (times: number): number => Math.min(times * 50, 2000);
/** ioredis's own default cluster backoff. */
const clusterReconnectDelayMs = (times: number): number => Math.min(100 + times * 2, 2000);

/**
 * A client waiting out its backoff. ioredis's `disconnect()` cancels the retry
 * timer but leaves the client `reconnecting` with its queue held, so such a
 * client is left to its next attempt, which `retryStrategy` turns into `end`.
 */
const WAITING_TO_RETRY = new Set(["reconnecting", "close"]);

/**
 * One connection and every duplicate of it. Once shutdown begins none of them
 * reconnects, so a command queued against a lost Redis fails instead of
 * waiting for a server that is not coming back.
 */
export class RedisClientFamily {
  private closingStarted = false;
  private lossReported = false;
  private readonly onAdopt: (client: RedisConnection) => void;

  constructor(onAdopt: (client: RedisConnection) => void) {
    this.onAdopt = onAdopt;
  }

  get closing(): boolean {
    return this.closingStarted;
  }

  /** `null` once closing: ioredis then ends the client and fails its queue. */
  readonly retryStrategy = (times: number): number | null =>
    this.closingStarted ? null : reconnectDelayMs(times);

  readonly clusterRetryStrategy = (times: number): number | null =>
    this.closingStarted ? null : clusterReconnectDelayMs(times);

  /** A duplicate: given the error listener ioredis does not copy. */
  adopt<Client extends RedisConnection>(client: Client): Client {
    this.onAdopt(client);
    return client;
  }

  /** True once: the one loss after shutdown that is worth a log line. */
  firstLossAfterClosing(): boolean {
    if (this.lossReported) return false;
    this.lossReported = true;
    return true;
  }

  /** Stops reconnecting: each client ends at its next failed attempt, failing its queue. */
  beginShutdown(): void {
    this.closingStarted = true;
  }
}

/**
 * Closes a client without stranding its queue. One between attempts ends at
 * its next failure (the family no longer retries) or, should the server come
 * back first, as soon as it is ready again.
 */
export function endPromptly(client: RedisConnection): void {
  if (!WAITING_TO_RETRY.has(client.status)) {
    client.disconnect();
    return;
  }
  client.once("ready", () => client.disconnect());
}

/**
 * A standalone client that hands its family to every duplicate, and whose
 * QUIT on a lost server after shutdown began disconnects at once: ioredis
 * would queue it behind commands that are never sent.
 */
export class FamilyRedis extends IORedis {
  family: RedisClientFamily | undefined;

  override duplicate(override?: Partial<RedisOptions>): IORedis {
    const copy = new FamilyRedis({ ...this.options, ...override });
    copy.family = this.family;
    return this.family === undefined ? copy : this.family.adopt(copy);
  }

  override sendCommand(...args: Parameters<IORedis["sendCommand"]>): unknown {
    const [command] = args;
    if (this.family?.closing === true && command.name === "quit" && this.status !== "ready") {
      endPromptly(this);
      command.resolve(Buffer.from("OK"));
      return command.promise;
    }
    return super.sendCommand(...args);
  }
}

/** A cluster client whose duplicates join its family. */
export class FamilyCluster extends Cluster {
  family: RedisClientFamily | undefined;

  override duplicate(overrideStartupNodes?: unknown[], overrideOptions?: object): Cluster {
    const copy = super.duplicate(overrideStartupNodes, overrideOptions);
    return this.family === undefined ? copy : this.family.adopt(copy);
  }
}

/** The family a connection this package opened belongs to. */
export function familyOf(connection: RedisConnection): RedisClientFamily | undefined {
  if (connection instanceof FamilyRedis || connection instanceof FamilyCluster) {
    return connection.family;
  }
  return undefined;
}
