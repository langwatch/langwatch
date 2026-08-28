import {
  ClickHouseClientFactory,
  type ClickHouseClientCreationInput,
  type ClickHouseCloseableClient,
} from "./connection";
import type { AbortSignalLike } from "./query";
import { ConcurrencyLimiter, QueueFullError, type LimiterStats } from "./rateLimit";
import {
  VendorClientResiliencePolicy,
  type VendorClientPolicy,
  type VendorClientResilienceOptions,
} from "./vendorClient";

declare const performance: { now(): number };
declare const AbortController: new () => { abort(): void; signal: AbortSignalLike };
declare const AbortSignal: { any(signals: AbortSignalLike[]): AbortSignalLike };
declare function setTimeout(callback: () => void, milliseconds: number): { unref?(): void };
declare function clearTimeout(timer: { unref?(): void }): void;

export const DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_CLICKHOUSE_IDLE_SOCKET_TTL_MS = 1_500;
export const DEFAULT_STATEMENT_QUEUE_DEPTH_PER_SLOT = 8;
export const DEFAULT_MIN_STATEMENT_QUEUE_DEPTH = 64;
export const DEFAULT_STATEMENT_WAIT_TIMEOUT_MS = 20_000;

export interface ClickHouseVendorClient extends ClickHouseCloseableClient {
  query(params: unknown): Promise<unknown>;
  insert(params: unknown): Promise<unknown>;
  command?(params: unknown): Promise<unknown>;
  exec?(params: unknown): Promise<unknown>;
  ping?(): Promise<unknown>;
}

export interface ClickHouseVendorClientOptions {
  url: string;
  instance: string;
  cluster: string;
  maxOpenConnections: number;
  requestTimeoutMs: number;
  idleSocketTtlMs: number;
  driverSettings: Readonly<Record<string, string | number | boolean | undefined>>;
  vendorLoggerClass?: unknown;
}

export abstract class ClickHouseVendorClientFactory<Client extends ClickHouseVendorClient> {
  abstract create(options: ClickHouseVendorClientOptions): Client;
}

export abstract class ClickHouseManagedClientLogger {
  abstract info(fields: Record<string, unknown>, message: string): void;
  abstract warn(fields: Record<string, unknown>, message: string): void;
}

export abstract class ClickHouseManagedClientTelemetry {
  abstract registerLimiter(input: { instance: string; stats: () => LimiterStats }): void;
  abstract unregisterLimiter(instance: string): void;
  abstract observeStatementWait(input: {
    instance: string;
    operation: ClickHouseStatementOperation;
    seconds: number;
  }): void;
  abstract incrementStatementsShed(input: {
    instance: string;
    operation: ClickHouseStatementOperation;
  }): void;
}

/** Maps a client-side admission refusal to the process's public error type. */
export abstract class ClickHouseOverloadErrorFactory {
  abstract create(input: { cause: unknown }): unknown;
}

export type ClickHouseStatementOperation = "query" | "insert" | "command" | "exec";

export interface ClickHouseManagedClientOptions<Client extends ClickHouseVendorClient> {
  vendorClientFactory: ClickHouseVendorClientFactory<Client>;
  defaultQuerySettings: Readonly<Record<string, unknown>>;
  resilience: VendorClientPolicy;
  telemetry: ClickHouseManagedClientTelemetry;
  overloadErrorFactory: ClickHouseOverloadErrorFactory;
  logger?: ClickHouseManagedClientLogger | undefined;
  vendorLoggerClass?: unknown;
  statementQueueDepthPerSlot?: number | undefined;
  minimumStatementQueueDepth?: number | undefined;
  statementWaitTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
  idleSocketTtlMs?: number | undefined;
}

/**
 * The portable policy stack around a vendor ClickHouse client. Driver creation,
 * typed error mapping, metrics, tracing and log destinations are injected by
 * the process that owns them; no package reads environment or global state.
 */
export class ClickHouseManagedClientService<
  Client extends ClickHouseVendorClient,
> extends ClickHouseClientFactory<Client> {
  private constructor(private readonly options: ClickHouseManagedClientOptions<Client>) {
    super();
  }

  static create<Client extends ClickHouseVendorClient>(
    options: ClickHouseManagedClientOptions<Client>,
  ): ClickHouseManagedClientService<Client> {
    return new ClickHouseManagedClientService(options);
  }

  create(input: ClickHouseClientCreationInput): Client {
    const raw = this.options.vendorClientFactory.create({
      url: input.url,
      instance: input.instance,
      cluster: input.cluster,
      maxOpenConnections: input.maxOpenConnections,
      requestTimeoutMs: this.options.requestTimeoutMs ?? DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS,
      idleSocketTtlMs: this.options.idleSocketTtlMs ?? DEFAULT_CLICKHOUSE_IDLE_SOCKET_TTL_MS,
      driverSettings: { date_time_input_format: "best_effort" },
      ...(this.options.vendorLoggerClass === undefined
        ? {}
        : { vendorLoggerClass: this.options.vendorLoggerClass }),
    });
    const resilient = createResilientVendorClient({
      client: raw,
      cluster: input.cluster,
      policy: this.options.resilience,
    });
    const limited = withClickHouseStatementLimit({
      client: resilient,
      input,
      telemetry: this.options.telemetry,
      overloadErrorFactory: this.options.overloadErrorFactory,
      logger: this.options.logger,
      statementQueueDepthPerSlot: this.options.statementQueueDepthPerSlot,
      minimumStatementQueueDepth: this.options.minimumStatementQueueDepth,
      statementWaitTimeoutMs: this.options.statementWaitTimeoutMs,
    });
    return withClickHouseDefaultQuerySettings(limited, this.options.defaultQuerySettings);
  }
}

export interface ClickHouseStatementLimitOptions<Client extends ClickHouseVendorClient> {
  client: Client;
  input: ClickHouseClientCreationInput;
  telemetry: ClickHouseManagedClientTelemetry;
  overloadErrorFactory: ClickHouseOverloadErrorFactory;
  logger?: ClickHouseManagedClientLogger | undefined;
  statementQueueDepthPerSlot?: number | undefined;
  minimumStatementQueueDepth?: number | undefined;
  statementWaitTimeoutMs?: number | undefined;
}

/** Bounds every vendor statement method while preserving the caller's cancellation signal. */
export function withClickHouseStatementLimit<Client extends ClickHouseVendorClient>(
  options: ClickHouseStatementLimitOptions<Client>,
): Client {
  const { client, input, telemetry, overloadErrorFactory, logger } = options;
  const timeoutMs = options.statementWaitTimeoutMs ?? DEFAULT_STATEMENT_WAIT_TIMEOUT_MS;
  const maxQueued = Math.max(
    options.minimumStatementQueueDepth ?? DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
    input.maxOpenConnections *
      (options.statementQueueDepthPerSlot ?? DEFAULT_STATEMENT_QUEUE_DEPTH_PER_SLOT),
  );
  const limiter = new ConcurrencyLimiter({
    maxConcurrent: input.maxOpenConnections,
    maxQueued,
  });
  telemetry.registerLimiter({ instance: input.instance, stats: () => limiter.stats() });
  logger?.info(
    { instance: input.instance, maxConcurrent: input.maxOpenConnections, maxQueued },
    "ClickHouse statement concurrency bounded",
  );

  const run = async ({
    operation,
    params,
    task,
  }: {
    operation: ClickHouseStatementOperation;
    params: unknown;
    task: () => Promise<unknown>;
  }): Promise<unknown> => {
    const startedAt = performance.now();
    let admitted = false;
    const wait = armStatementWait({ limiter, input, params, timeoutMs });
    try {
      return await limiter.run({
        signal: wait.signal,
        task: () => {
          admitted = true;
          wait.dispose();
          telemetry.observeStatementWait({
            instance: input.instance,
            operation,
            seconds: (performance.now() - startedAt) / 1_000,
          });
          return task();
        },
      });
    } catch (error) {
      if (!admitted && error instanceof QueueFullError) {
        telemetry.incrementStatementsShed({ instance: input.instance, operation });
        logger?.warn(
          { instance: input.instance, operation, maxQueued },
          "Refused a ClickHouse statement: concurrency wait queue full",
        );
        throw overloadErrorFactory.create({ cause: error });
      }
      if (!admitted && wait.hasTimedOut()) {
        telemetry.incrementStatementsShed({ instance: input.instance, operation });
        logger?.warn(
          {
            instance: input.instance,
            operation,
            waitedMs: Math.round(performance.now() - startedAt),
            timeoutMs,
          },
          "Refused a ClickHouse statement: waited too long for a slot",
        );
        throw overloadErrorFactory.create({ cause: error });
      }
      throw error;
    } finally {
      wait.dispose();
    }
  };

  let closePromise: Promise<void> | undefined;
  return new Proxy(client, {
    get(target, property) {
      if (property === "query") {
        return (params: unknown) =>
          run({ operation: "query", params, task: () => target.query(params) });
      }
      if (property === "insert") {
        return (params: unknown) =>
          run({ operation: "insert", params, task: () => target.insert(params) });
      }
      const command = target.command;
      if (property === "command" && command !== undefined) {
        return (params: unknown) =>
          run({ operation: "command", params, task: () => command.call(target, params) });
      }
      const exec = target.exec;
      if (property === "exec" && exec !== undefined) {
        return (params: unknown) =>
          run({ operation: "exec", params, task: () => exec.call(target, params) });
      }
      const ping = target.ping;
      if (property === "ping" && ping !== undefined) return () => ping.call(target);
      if (property === "close") {
        return () => {
          closePromise ??= closeClient();
          return closePromise;
        };
      }
      return Reflect.get(target, property, target);
    },
  });

  async function closeClient(): Promise<void> {
    try {
      await client.close();
    } finally {
      telemetry.unregisterLimiter(input.instance);
    }
  }
}

/** Adds process-selected query defaults without changing insert, command, exec or lifecycle calls. */
export function withClickHouseDefaultQuerySettings<Client extends ClickHouseVendorClient>(
  client: Client,
  defaults: Readonly<Record<string, unknown>>,
): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property !== "query") return Reflect.get(target, property, target);
      return (params: unknown) => {
        const input = recordOf(params);
        const settings = recordOf(input.clickhouse_settings);
        return target.query({
          ...input,
          clickhouse_settings: { ...defaults, ...settings },
        });
      };
    },
  });
}

/** Applies the shared retry, reporting and in-band result policy to an existing vendor client. */
export function createResilientVendorClient<Client extends ClickHouseVendorClient>({
  client,
  cluster,
  policy,
}: {
  client: Client;
  cluster: string;
  policy: VendorClientPolicy;
}): Client {
  const resilient = policy.wrap(client, cluster);
  return new Proxy(resilient, {
    get(target, property) {
      if (property === "close") {
        const close = client.close;
        return () => close.call(client);
      }
      const command = client.command;
      if (property === "command" && command !== undefined) {
        return (params: unknown) => command.call(client, params);
      }
      const exec = client.exec;
      if (property === "exec" && exec !== undefined)
        return (params: unknown) => exec.call(client, params);
      const ping = client.ping;
      if (property === "ping" && ping !== undefined) return () => ping.call(client);
      return Reflect.get(target, property, target);
    },
  });
}

/** Compatibility helper for direct callers that have not yet composed a policy service. */
export function createVendorClientResiliencePolicy(
  options: VendorClientResilienceOptions = {},
): VendorClientPolicy {
  return VendorClientResiliencePolicy.create(options);
}

interface ArmedWait {
  signal: AbortSignalLike | undefined;
  hasTimedOut(): boolean;
  dispose(): void;
}

function armStatementWait({
  limiter,
  input,
  params,
  timeoutMs,
}: {
  limiter: ConcurrencyLimiter;
  input: ClickHouseClientCreationInput;
  params: unknown;
  timeoutMs: number;
}): ArmedWait {
  const signal = signalOf(params);
  if (limiter.stats().inFlight < input.maxOpenConnections) return unarmedWait(signal);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]),
    hasTimedOut: () => timedOut,
    dispose: () => clearTimeout(timer),
  };
}

function unarmedWait(signal: AbortSignalLike | undefined): ArmedWait {
  return { signal, hasTimedOut: () => false, dispose: () => undefined };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? { ...value } : {};
}

function signalOf(params: unknown): AbortSignalLike | undefined {
  const signal = recordOf(params).abort_signal;
  if (signal === null || typeof signal !== "object") return undefined;
  if (
    !("aborted" in signal) ||
    !("addEventListener" in signal) ||
    !("removeEventListener" in signal)
  ) {
    return undefined;
  }
  return signal as AbortSignalLike;
}
