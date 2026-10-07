import {
  ClickHouseClientFactory,
  type ClickHouseClientCreationInput,
  type ClickHouseCloseableClient,
} from "./connection.ts";
import type { AbortSignalLike } from "./query.ts";
import { ConcurrencyLimiter, QueueFullError, type LimiterStats } from "./rateLimit.ts";
import {
  checkStatementTenantScope,
  describeTenantScopeViolation,
  tableNamedBy,
} from "./tenantGuard.ts";
import {
  VendorClientResiliencePolicy,
  type VendorClientPolicy,
  type VendorClientResilienceOptions,
} from "./vendorClient.ts";

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
/** Each kind's slots held back for the other (`CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE`). */
export const DEFAULT_STATEMENT_LANE_RESERVE_SHARE = 0.25;

/** Inserts and reads are bounded apart; "all" is the one bound of a pool too small to split. */
export type ClickHouseStatementLane = "read" | "insert" | "all";

export interface ClickHouseLaneStats {
  lane: ClickHouseStatementLane;
  inFlight: number;
  queued: number;
}

export interface ClickHouseVendorClient extends ClickHouseCloseableClient {
  query(params: unknown): Promise<unknown>;
  insert(params: unknown): Promise<unknown>;
  command?: (params: unknown) => Promise<unknown>;
  exec?: (params: unknown) => Promise<unknown>;
  ping?: () => Promise<unknown>;
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
  abstract error(fields: Record<string, unknown>, message: string): void;
}

export abstract class ClickHouseManagedClientTelemetry {
  /** `lanes` reports each statement lane; a sink that omits it sees only the total. */
  abstract registerLimiter(input: {
    instance: string;
    stats: () => LimiterStats;
    lanes?: () => readonly ClickHouseLaneStats[];
  }): void;
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
  statementLaneReserveShare?: number | undefined;
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
      statementLaneReserveShare: this.options.statementLaneReserveShare,
    });
    const defaulted = withClickHouseDefaultQuerySettings(
      limited,
      this.options.defaultQuerySettings,
    );
    return withClickHouseTenantScope({
      client: defaulted,
      instance: input.instance,
      logger: this.options.logger,
    });
  }
}

/**
 * A statement that genuinely spans tenants, and the written reason it does.
 */
export interface UnscopedStatementDeclaration {
  reason: string;
}

/**
 * Refuses a `query` whose SQL names no tenant, outermost of every policy so a statement that
 * must not run never spends a slot or a socket. The refusal is a plain `Error`: a bug in a
 * query we wrote, logged with table and statement head.
 */
export function withClickHouseTenantScope<Client extends ClickHouseVendorClient>({
  client,
  instance,
  logger,
}: {
  client: Client;
  instance: string;
  logger?: ClickHouseManagedClientLogger | undefined;
}): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property !== "query") return Reflect.get(target, property, target);
      // Async, so a refusal arrives as a rejected promise like every other
      // failure on this call rather than as a synchronous throw the caller's
      // `.catch` would miss.
      return async (params: unknown) => {
        const { unscoped, ...forwarded } = recordOf(params);
        const sql = typeof forwarded.query === "string" ? forwarded.query : "";
        if (unscoped === undefined) {
          const violation = checkStatementTenantScope({ sql });
          if (violation !== null) {
            const table = tableNamedBy(sql);
            const head = sql.trim().slice(0, 80);
            logger?.error(
              { instance, table, violation: violation.kind, statement: head },
              "Refused a ClickHouse statement: it names no tenant",
            );
            throw new Error(
              `ClickHouse statement on table "${table}" is not tenant-scoped: ${head} — ${describeTenantScopeViolation(violation)}`,
            );
          }
        }
        return target.query(forwarded);
      };
    },
  });
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
  statementLaneReserveShare?: number | undefined;
}

export interface ClickHouseStatementAdmissionOptions {
  instance: string;
  maxConcurrent: number;
  telemetry: ClickHouseManagedClientTelemetry;
  overloadErrorFactory: ClickHouseOverloadErrorFactory;
  logger?: ClickHouseManagedClientLogger | undefined;
  statementQueueDepthPerSlot?: number | undefined;
  minimumStatementQueueDepth?: number | undefined;
  statementWaitTimeoutMs?: number | undefined;
  /** Fraction of `maxConcurrent` each kind keeps for the other; default 0.25. */
  reserveShare?: number | undefined;
}

/**
 * The statement bound: `maxConcurrent` slots, a queue of max(64, slots x 8), a 20s wait. Inserts
 * and reads each reserve slots the other cannot take (ADR-114, #8480). A refusal throws the
 * overload error; an admitted statement's own errors pass through untouched.
 */
export class ClickHouseStatementAdmission {
  readonly maxQueued: number;
  readonly reserve: number;
  private readonly total: ConcurrencyLimiter;
  private readonly lanes: readonly StatementLane[];
  private readonly timeoutMs: number;

  constructor(private readonly options: ClickHouseStatementAdmissionOptions) {
    this.maxQueued = Math.max(
      options.minimumStatementQueueDepth ?? DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
      options.maxConcurrent *
        (options.statementQueueDepthPerSlot ?? DEFAULT_STATEMENT_QUEUE_DEPTH_PER_SLOT),
    );
    this.timeoutMs = options.statementWaitTimeoutMs ?? DEFAULT_STATEMENT_WAIT_TIMEOUT_MS;
    this.total = new ConcurrencyLimiter({
      maxConcurrent: options.maxConcurrent,
      maxQueued: this.maxQueued,
    });
    const caps = statementLaneCaps({
      maxConcurrent: options.maxConcurrent,
      reserveShare: options.reserveShare ?? DEFAULT_STATEMENT_LANE_RESERVE_SHARE,
    });
    this.reserve = caps?.reserve ?? 0;
    // Each lane queue holds half the single-queue bound, so together they equal it.
    this.lanes =
      caps === null
        ? [statementLane({ lane: "all", capMax: options.maxConcurrent, maxQueued: null })]
        : (["insert", "read"] as const).map((lane) =>
            statementLane({
              lane,
              capMax: caps.laneCap,
              maxQueued: Math.floor(this.maxQueued / 2),
            }),
          );
    options.logger?.info(
      {
        instance: options.instance,
        maxConcurrent: options.maxConcurrent,
        maxQueued: this.maxQueued,
        reserve: this.reserve,
        lanes: this.lanes.map(({ lane, capMax }) => ({ lane, cap: capMax })),
      },
      "ClickHouse statement concurrency bounded",
    );
  }

  stats(): LimiterStats {
    return this.total.stats();
  }

  /** Per lane: what it runs on the driver, and all that waits behind its cap or the total. */
  laneStats(): ClickHouseLaneStats[] {
    return this.lanes.map(({ lane, cap, running }) => {
      if (cap === null) return { lane, inFlight: running, queued: this.total.stats().queued };
      const { inFlight, queued } = cap.stats();
      return { lane, inFlight: running, queued: queued + inFlight - running };
    });
  }

  /** Runs `task` once its lane and the total grant a slot, or refuses it as overloaded. */
  async run<T>({
    operation,
    signal,
    task,
  }: {
    operation: ClickHouseStatementOperation;
    signal?: AbortSignalLike | undefined;
    task: () => Promise<T>;
  }): Promise<T> {
    const { instance, telemetry } = this.options;
    const lane = this.laneFor(operation);
    const startedAt = performance.now();
    let admitted = false;
    const wait = new StatementWait({ signal, timeoutMs: this.timeoutMs });
    const onDriver = async (): Promise<T> => {
      admitted = true;
      lane.running += 1;
      wait.dispose();
      telemetry.observeStatementWait({
        instance,
        operation,
        seconds: (performance.now() - startedAt) / 1_000,
      });
      try {
        return await task();
      } finally {
        lane.running -= 1;
      }
    };
    try {
      return await this.acquire({ lane, wait, onDriver });
    } catch (error) {
      if (admitted) throw error;
      throw this.refusal({ error, timedOut: wait.hasTimedOut(), operation, startedAt });
    } finally {
      wait.dispose();
    }
  }

  private laneFor(operation: ClickHouseStatementOperation): StatementLane {
    const wanted: ClickHouseStatementLane = operation === "insert" ? "insert" : "read";
    return this.lanes.find(({ lane }) => lane === wanted) ?? this.lanes[0]!;
  }

  /**
   * The lane cap, then the total. The wait is armed at whichever limiter is full at the moment
   * it is entered: a same-tick batch reaches the total only from inside its cap's grant, so an
   * up-front check would read a total no statement has entered yet and arm nothing.
   */
  private acquire<T>({
    lane,
    wait,
    onDriver,
  }: {
    lane: StatementLane;
    wait: StatementWait;
    onDriver: () => Promise<T>;
  }): Promise<T> {
    const runInTotal = () => {
      wait.armIf(this.total.stats().inFlight >= this.options.maxConcurrent);
      return this.total.run({ task: onDriver, signal: wait.signal });
    };
    if (lane.cap === null) return runInTotal();
    wait.armIf(lane.cap.stats().inFlight >= lane.capMax);
    return lane.cap.run({ task: runInTotal, signal: wait.signal });
  }

  /**
   * What a statement that never got a slot throws: an overload error, counted as
   * shed, when the queue was full or the wait timed out; otherwise its own error.
   */
  private refusal({
    error,
    timedOut,
    operation,
    startedAt,
  }: {
    error: unknown;
    timedOut: boolean;
    operation: ClickHouseStatementOperation;
    startedAt: number;
  }): unknown {
    const { instance, telemetry, overloadErrorFactory, logger } = this.options;
    if (error instanceof QueueFullError) {
      telemetry.incrementStatementsShed({ instance, operation });
      logger?.warn(
        { instance, operation, maxQueued: error.maxQueued },
        "Refused a ClickHouse statement: concurrency wait queue full",
      );
      return overloadErrorFactory.create({ cause: error });
    }
    if (timedOut) {
      telemetry.incrementStatementsShed({ instance, operation });
      logger?.warn(
        {
          instance,
          operation,
          waitedMs: Math.round(performance.now() - startedAt),
          timeoutMs: this.timeoutMs,
        },
        "Refused a ClickHouse statement: waited too long for a slot",
      );
      return overloadErrorFactory.create({ cause: error });
    }
    return error;
  }
}

/**
 * Work-conserving lane caps over one slot budget: `reserve` slots are held back for the other
 * kind and a lane may hold the rest. The reserve is at least one slot and at most half the
 * budget; under two slots nothing can be reserved, so the answer is null (one shared bound).
 */
export function statementLaneCaps({
  maxConcurrent,
  reserveShare,
}: {
  maxConcurrent: number;
  reserveShare: number;
}): { reserve: number; laneCap: number } | null {
  if (maxConcurrent < 2) return null;
  const reserve = Math.min(
    Math.floor(maxConcurrent / 2),
    Math.max(1, Math.round(maxConcurrent * reserveShare)),
  );
  return { reserve, laneCap: maxConcurrent - reserve };
}

/** One kind's lane: the cap it enters before the total (none for "all"), and what it runs now. */
interface StatementLane {
  lane: ClickHouseStatementLane;
  cap: ConcurrencyLimiter | null;
  capMax: number;
  running: number;
}

function statementLane({
  lane,
  capMax,
  maxQueued,
}: {
  lane: ClickHouseStatementLane;
  capMax: number;
  maxQueued: number | null;
}): StatementLane {
  return {
    lane,
    capMax,
    running: 0,
    cap: maxQueued === null ? null : new ConcurrencyLimiter({ maxConcurrent: capMax, maxQueued }),
  };
}

/**
 * One statement's wait bound, armed lazily and at most once across the cap and the total. A
 * plain timer, cleared at admission, so the unsaturated path allocates nothing and a test can
 * fake it. `hasTimedOut` is true only when this timer fired, never for the caller's own abort.
 */
class StatementWait {
  private composed: AbortSignalLike | undefined;
  private timer: { unref?(): void } | undefined;
  private fired = false;
  private readonly callerSignal: AbortSignalLike | undefined;
  private readonly timeoutMs: number;

  constructor({ signal, timeoutMs }: { signal: AbortSignalLike | undefined; timeoutMs: number }) {
    this.callerSignal = signal;
    this.timeoutMs = timeoutMs;
  }

  get signal(): AbortSignalLike | undefined {
    return this.composed ?? this.callerSignal;
  }

  armIf(isFull: boolean): void {
    if (!isFull || this.timer !== undefined) return;
    const controller = new AbortController();
    this.composed =
      this.callerSignal === undefined
        ? controller.signal
        : AbortSignal.any([this.callerSignal, controller.signal]);
    this.timer = setTimeout(() => {
      this.fired = true;
      controller.abort();
    }, this.timeoutMs);
    this.timer.unref?.();
  }

  hasTimedOut(): boolean {
    return this.fired;
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
  }
}

const STATEMENT_METHODS: readonly ClickHouseStatementOperation[] = [
  "query",
  "insert",
  "command",
  "exec",
];

/** A statement method, bound through the limiter; none for any other property. */
function boundStatementMethod({
  target,
  property,
  run,
}: {
  target: ClickHouseVendorClient;
  property: string | symbol;
  run: (options: {
    operation: ClickHouseStatementOperation;
    params: unknown;
    task: () => Promise<unknown>;
  }) => Promise<unknown>;
}): ((params: unknown) => Promise<unknown>)[] {
  const operation = STATEMENT_METHODS.find((name) => name === property);
  if (operation === undefined) return [];
  const method: ((params: unknown) => Promise<unknown>) | undefined = target[operation];
  if (method === undefined) return [];
  return [(params: unknown) => run({ operation, params, task: () => method.call(target, params) })];
}

/** Bounds every vendor statement method while preserving the caller's cancellation signal. */
export function withClickHouseStatementLimit<Client extends ClickHouseVendorClient>(
  options: ClickHouseStatementLimitOptions<Client>,
): Client {
  const { client, input, telemetry } = options;
  const admission = new ClickHouseStatementAdmission({
    instance: input.instance,
    maxConcurrent: input.maxOpenConnections,
    telemetry,
    overloadErrorFactory: options.overloadErrorFactory,
    logger: options.logger,
    statementQueueDepthPerSlot: options.statementQueueDepthPerSlot,
    minimumStatementQueueDepth: options.minimumStatementQueueDepth,
    statementWaitTimeoutMs: options.statementWaitTimeoutMs,
    reserveShare: options.statementLaneReserveShare,
  });
  telemetry.registerLimiter({
    instance: input.instance,
    stats: () => admission.stats(),
    lanes: () => admission.laneStats(),
  });

  const run = ({
    operation,
    params,
    task,
  }: {
    operation: ClickHouseStatementOperation;
    params: unknown;
    task: () => Promise<unknown>;
  }): Promise<unknown> => admission.run({ operation, signal: signalOf(params), task });

  let closePromise: Promise<void> | undefined;
  return new Proxy(client, {
    get(target, property) {
      const [statement] = boundStatementMethod({ target, property, run });
      if (statement) return statement;
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

/**
 * Adds process-selected query defaults without changing insert, command, exec or lifecycle
 * calls.
 */
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

/**
 * Default ClickHouse query settings, capping memory so one query can't OOM
 * the server. `max_memory_usage` is omitted on purpose — the server's
 * Terraform profile already caps it per-query; client-side would only raise it.
 */
export const DEFAULT_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};

/**
 * `wait_for_async_insert`: avoids a stale Redis-miss read racing the flush.
 * `input_format_skip_unknown_fields: 0`: fails loudly on a migration-race
 * schema mismatch, instead of silently corrupting a row past the version gate.
 */
export const READ_BACK_FOLD_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;
