/**
 * The CLI's live event channel: a running commentary on a command while it runs,
 * so the Langy panel can show a status line, a rolling stat card and a progress
 * bar instead of a spinner.
 *
 * Three rules shape everything in here, in this order:
 *
 * 1. OFF BY DEFAULT, AT ZERO COST. The CLI is a user-facing product. With no
 *    transport configured, `createCommandEvents` hands back a frozen no-op: no
 *    exporter, no socket, no timer, no extra byte on stdout. The OTLP path is
 *    loaded through a deferred `import()` rather than a top-level one, because
 *    pulling `@opentelemetry/sdk-logs` and the exporter into the module graph
 *    costs ~60ms of parse+init on EVERY `langwatch` invocation — measured, 28ms
 *    to 90ms — and a user who never asked for telemetry must not pay it. (The IPC
 *    sink needs no such trick: it imports node builtins only.)
 *
 * 2. TELEMETRY IS NEVER THE USER'S PROBLEM. Every emit is fire-and-forget onto a
 *    serial chain: call sites never await, never see a rejection, never slow down.
 *    A collector that 500s, hangs, or does not exist can only ever cost the
 *    bounded flush at the end of the command.
 *
 * 3. NO CREDENTIALS, EVER. Failure messages are scrubbed — of anything shaped
 *    like a secret, and of the literal values of this process's own secrets —
 *    before they leave.
 *
 * The wire itself is deliberately not this module's business; see `sink.ts`.
 *
 * Spec: specs/telemetry/langy-live-events.feature
 */

// The zod-free subpath, deliberately: this module is on the hot path of every
// instrumented command, and the package root pulls in the (zod-based) card
// schemas, which cost ~28ms an invocation to load and which nothing here needs.
import { handledErrorFromThrown } from "@langwatch/langy/cards/handled-error";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import {
  LANGWATCH_EVENT_ATTRIBUTES as ATTR,
  LANGWATCH_EVENTS,
  LANGWATCH_EVENTS_SCOPE,
  LANGWATCH_EVENTS_SOCKET_ENV,
  LANGWATCH_OTEL_EVENTS_ENV,
  type LangWatchEvent,
} from "./attributes";
import { createIpcSink, type EventRecord, type EventSink } from "./sink";

/** How long `flush()` may hold up the command's exit, whatever the far end does. */
const FLUSH_TIMEOUT_MS = 2_000;
/** How long a single OTLP export may take before the exporter abandons it. */
const EXPORT_TIMEOUT_MS = 2_000;
/** Messages are truncated to this before they leave the process. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * One command's live event channel. Every method is fire-and-forget: nothing
 * throws, nothing blocks, nothing needs awaiting except {@link CommandEvents.flush}.
 */
export interface CommandEvents {
  /** The command has begun. */
  started: (message: string) => void;
  /** A headline number is known — the stat card's value. */
  count: (args: { count: number; total?: number; message: string }) => void;
  /** The command advanced. `progress` is a 0..1 fraction; out-of-range is clamped. */
  progress: (args: {
    progress: number;
    count?: number;
    total?: number;
    message: string;
  }) => void;
  /** The command succeeded. Duration is measured from `createCommandEvents`. */
  completed: (args: { count?: number; total?: number; message: string }) => void;
  /**
   * The command failed. The error is read back into the platform's own structured
   * failure (kind + status) rather than flattened to prose, and scrubbed of
   * credentials before it leaves.
   */
  failed: (args: { error: unknown; message?: string }) => void;
  /**
   * Push anything buffered. Bounded: a dead far end delays the command by at most
   * {@link FLUSH_TIMEOUT_MS}. Safe when disabled, and safe to call twice.
   */
  flush: () => Promise<void>;
}

/** Handed to every command when no transport is configured. Costs one lookup. */
const NOOP_EVENTS: CommandEvents = Object.freeze({
  started: () => undefined,
  count: () => undefined,
  progress: () => undefined,
  completed: () => undefined,
  failed: () => undefined,
  flush: () => Promise.resolve(),
});

const isTruthy = (value: string | undefined): boolean =>
  value !== undefined &&
  ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());

/**
 * The OTLP logs endpoint, per the OTEL exporter spec: the signal-specific var
 * wins and is used verbatim; the generic var is a base that `/v1/logs` hangs off.
 * Null when neither is set — which, flag or no flag, means no OTLP transport.
 */
export const resolveLogsEndpoint = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const signal = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
  if (signal) return signal;

  const generic = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (generic) return `${generic.replace(/\/+$/, "")}/v1/logs`;

  return null;
};

/** Which transport, if any, this environment is asking for. */
export type Transport =
  | { kind: "ipc"; path: string }
  | { kind: "otlp"; endpoint: string }
  | null;

/**
 * Resolve the transport. A pure env read — this is the gate that keeps a disabled
 * CLI at zero cost, so it must stay free of imports and side effects.
 *
 * IPC wins when both are configured: a host that handed us a socket is a host that
 * is listening, and the socket is both cheaper to load and faster to deliver.
 */
export const resolveTransport = (
  env: NodeJS.ProcessEnv = process.env,
): Transport => {
  const socket = env[LANGWATCH_EVENTS_SOCKET_ENV]?.trim();
  if (socket) return { kind: "ipc", path: socket };

  if (!isTruthy(env[LANGWATCH_OTEL_EVENTS_ENV])) return null;

  const endpoint = resolveLogsEndpoint(env);
  return endpoint === null ? null : { kind: "otlp", endpoint };
};

/** Whether anything at all will be emitted. */
export const areEventsEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => resolveTransport(env) !== null;

const truncate = (value: string): string =>
  value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;

/** Env vars whose *values* must never appear in an outbound message. */
const SECRET_ENV_VARS = [
  "LANGWATCH_API_KEY",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
];

/** Token shapes worth redacting even when they did not come from this environment. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pat-lw|lw|vk)[-_][A-Za-z0-9\-_]{8,}/gi,
  /\b(?:bearer|basic)\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b(?:api[-_]?key|authorization|x-auth-token|token|secret|password)["'\s:=]+[A-Za-z0-9\-._~+/]{8,}=*/gi,
];

/**
 * Scrub a message before it leaves the process. Belt and braces: the literal
 * values of this environment's secrets go first — the strongest guarantee, since
 * an API key echoed back by a server is caught by value whatever shape it has —
 * then anything that merely LOOKS like a credential.
 */
export const redactSecrets = (
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  let scrubbed = message;

  for (const name of SECRET_ENV_VARS) {
    const value = env[name]?.trim();
    // A very short value would match half the message; it is not a real secret.
    if (value && value.length >= 8) {
      scrubbed = scrubbed.split(value).join("[redacted]");
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[redacted]");
  }

  return truncate(scrubbed);
};

/** A promise that resolves after `ms` without holding the event loop open. */
const softDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // The whole point: a pending flush must never be why the CLI is still running.
    timer.unref?.();
  });

/**
 * The OTLP logs sink. Everything heavy is imported here, on the enabled path only
 * — see rule 1 in the module docstring.
 *
 * `SimpleLogRecordProcessor`, not the batch one, because this is a LIVE channel:
 * the panel wants "Searching traces…" now, not up to five seconds from now, and a
 * read command emits a handful of records, not a firehose.
 */
const createOtlpSink = async (endpoint: string): Promise<EventSink> => {
  const [{ LoggerProvider, SimpleLogRecordProcessor }, { OTLPLogExporter }, resources] =
    await Promise.all([
      import("@opentelemetry/sdk-logs"),
      import("@opentelemetry/exporter-logs-otlp-http"),
      import("@opentelemetry/resources"),
    ]);

  // `defaultResource()` does NOT read OTEL_RESOURCE_ATTRIBUTES — it only stamps
  // service.name + telemetry.sdk.*. Only `envDetector` reads it, so it is wired in
  // explicitly. This matters: Langy's worker passes `langy.conversation_id` /
  // `langy.turn_id` that way, and without the detector every event would arrive
  // uncorrelated and the panel would have nothing to attach it to.
  //
  // The detector reads `process.env` directly, per the OTEL spec — which is what we
  // want in production, where it and the injected `env` are the same object.
  //
  // Merge order is precedence order: the environment is the operator's word, and
  // wins over our defaults.
  const resource = resources
    .defaultResource()
    .merge(
      resources.resourceFromAttributes({
        "service.name": "langwatch-cli",
        "service.version": LANGWATCH_SDK_VERSION,
      }),
    )
    .merge(resources.detectResources({ detectors: [resources.envDetector] }));

  const provider = new LoggerProvider({
    resource,
    forceFlushTimeoutMillis: FLUSH_TIMEOUT_MS,
    processors: [
      new SimpleLogRecordProcessor(
        new OTLPLogExporter({ url: endpoint, timeoutMillis: EXPORT_TIMEOUT_MS }),
      ),
    ],
  });

  const logger = provider.getLogger(LANGWATCH_EVENTS_SCOPE, LANGWATCH_SDK_VERSION);

  return {
    emit: (record) => {
      logger.emit({
        // Severity numbers from the OTEL log data model.
        severityNumber: record.severity === "error" ? 17 : 9,
        severityText: record.severity === "error" ? "ERROR" : "INFO",
        body: record.message,
        attributes: record.attributes,
      });
    },
    flush: async () => {
      await provider.forceFlush();
      // Shutting the provider down aborts anything still in flight, so the process
      // can exit instead of waiting out the exporter's own timeout.
      await provider.shutdown();
    },
  };
};

const openSink = async (transport: NonNullable<Transport>): Promise<EventSink> =>
  transport.kind === "ipc"
    ? createIpcSink({ path: transport.path })
    : createOtlpSink(transport.endpoint);

/**
 * Open the live event channel for one command.
 *
 * Returns a no-op when no transport is configured, so a call site can emit
 * unconditionally and an unconfigured CLI pays nothing for the privilege.
 */
export const createCommandEvents = ({
  resource,
  verb,
  env = process.env,
}: {
  resource: string;
  verb: string;
  env?: NodeJS.ProcessEnv;
}): CommandEvents => {
  const transport = resolveTransport(env);
  if (transport === null) return NOOP_EVENTS;

  const startedAt = Date.now();
  let sink: Promise<EventSink> | null = null;

  // Set synchronously by `emit`, and the only thing `flush` may consult to decide
  // whether there is anything to drain. `sink` is assigned inside the queued
  // microtask, so it is still null the moment after an emit returns — reading THAT
  // from `flush` would make the flush a no-op and silently drop every event.
  let hasEmitted = false;

  // Emits are chained rather than raced so the far end sees
  // started → count → progress → completed in the order they happened. A failed
  // link is swallowed and the chain carries on: telemetry must not cascade.
  let queue: Promise<void> = Promise.resolve();

  const emit = (
    event: LangWatchEvent,
    attributes: Record<string, string | number | boolean>,
    { severity = "info", message }: { severity?: "info" | "error"; message: string },
  ): void => {
    hasEmitted = true;
    queue = queue
      .then(async () => {
        sink ??= openSink(transport);
        const open = await sink;
        const record: EventRecord = {
          event,
          message,
          severity,
          timestampMs: Date.now(),
          attributes: {
            [ATTR.resource]: resource,
            [ATTR.verb]: verb,
            [ATTR.event]: event,
            ...attributes,
          },
        };
        open.emit(record);
      })
      .catch(() => undefined);
  };

  return {
    started: (message) => {
      emit(LANGWATCH_EVENTS.started, { [ATTR.message]: truncate(message) }, { message });
    },

    count: ({ count, total, message }) => {
      emit(
        LANGWATCH_EVENTS.count,
        {
          [ATTR.count]: Math.trunc(count),
          ...(total === undefined ? {} : { [ATTR.total]: Math.trunc(total) }),
          [ATTR.message]: truncate(message),
        },
        { message },
      );
    },

    progress: ({ progress, count, total, message }) => {
      emit(
        LANGWATCH_EVENTS.progress,
        {
          [ATTR.progress]: Math.min(1, Math.max(0, progress)),
          ...(count === undefined ? {} : { [ATTR.count]: Math.trunc(count) }),
          ...(total === undefined ? {} : { [ATTR.total]: Math.trunc(total) }),
          [ATTR.message]: truncate(message),
        },
        { message },
      );
    },

    completed: ({ count, total, message }) => {
      emit(
        LANGWATCH_EVENTS.completed,
        {
          ...(count === undefined ? {} : { [ATTR.count]: Math.trunc(count) }),
          ...(total === undefined ? {} : { [ATTR.total]: Math.trunc(total) }),
          [ATTR.progress]: 1,
          [ATTR.durationMs]: Date.now() - startedAt,
          [ATTR.message]: truncate(message),
        },
        { message },
      );
    },

    failed: ({ error, message }) => {
      // Read the failure back into the structure the platform gave it, so the
      // panel gets a kind it can act on rather than a sentence it can only print.
      const handled = handledErrorFromThrown(error);
      const reason = redactSecrets(handled.message, env);
      const line = message ? redactSecrets(message, env) : reason;

      emit(
        LANGWATCH_EVENTS.error,
        {
          [ATTR.error]: reason,
          [ATTR.errorKind]: handled.kind,
          [ATTR.errorIsHandled]: handled.isHandled,
          ...(handled.httpStatus > 0
            ? { [ATTR.errorStatus]: handled.httpStatus }
            : {}),
          [ATTR.message]: line,
          [ATTR.durationMs]: Date.now() - startedAt,
        },
        { severity: "error", message: line },
      );
    },

    flush: async () => {
      // Nothing was ever emitted — there is no pipeline to flush.
      if (!hasEmitted) return;

      // Drain the emit chain, then push. The whole thing is raced against an
      // unref'd timer, so a far end that accepts the connection and then goes
      // quiet cannot hold the command open: the CLI's exit is bounded whatever
      // the collector or the host does.
      await Promise.race([
        queue.then(async () => {
          const open = await sink;
          await open?.flush();
        }),
        softDelay(FLUSH_TIMEOUT_MS),
      ]).catch(() => undefined);
    },
  };
};
