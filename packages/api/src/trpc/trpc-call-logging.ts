/**
 * One finished tRPC call, as the request log records it.
 *
 * Everything here is pure: the log target and the exception reporter arrive as
 * arguments, so the decisions — whether a call is recorded at all, at which
 * level, and with which status — can be asked directly.
 */
import { HandledError } from "@langwatch/handled-error";
import { createWarnThrottle, type Logger } from "@langwatch/observability";
import { getLogLevelFromStatusCode } from "@langwatch/observability/request";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

/**
 * How long a call may take before its record is raised from info to warning.
 *
 * A call that succeeds slowly used to log exactly like one that succeeded
 * instantly, so the only way to find one was for a customer to say a screen
 * felt broken. That is how the scenario editor's multi-second load went
 * unnoticed: every procedure on the path reported success, and the duration
 * was already on the record but never changed the level.
 *
 * One second, because that regression ran at 1.5 to 2.3 seconds per call
 * and a higher budget would have kept it invisible. Procedures that are
 * legitimately long (a model generating a draft, an export) still warn,
 * and the warning for those is still true: it states what the call cost.
 * The per-path throttle is what keeps the volume down.
 */
const DEFAULT_SLOW_CALL_MS = 1000;

const SLOW_CALL_THROTTLE_MS = 60_000;

const slowCallThrottle = createWarnThrottle(SLOW_CALL_THROTTLE_MS);

/** Zero or negative turns the warning off; unset or unparseable keeps the default. */
export function resolveSlowCallBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRPC_SLOW_CALL_MS;
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_SLOW_CALL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SLOW_CALL_MS;
}

/** Test seam: the throttle is process-wide state and must not leak between tests. */
export function resetSlowCallThrottle(): void {
  slowCallThrottle.reset();
}

/** Processes a tRPC call result and logs accordingly. Extracted for testability. */
export function handleTrpcCallLogging({
  result,
  path,
  type,
  duration,
  userAgent,
  statusCode,
  log,
  capture,
  slowCallBudgetMs = resolveSlowCallBudgetMs(),
  now = Date.now(),
}: {
  result: { ok: boolean; error?: unknown };
  path: string;
  type: string;
  duration: number;
  userAgent: string | null;
  statusCode: number | null;
  log: Pick<Logger, "info" | "warn" | "error">;
  /**
   * Reports an unhandled server fault. Takes the failure as it arrived: the
   * process owns how an unknown value becomes an Error, and coercing it here
   * would put a second copy of that rule in this package.
   */
  capture: (failure: unknown) => void;
  slowCallBudgetMs?: number;
  now?: number;
}): void {
  const logData: {
    path: string;
    type: string;
    duration: number;
    userAgent: string | null;
    statusCode: number | null;
    error?: unknown;
    handledErrorCode?: string;
    handledErrorFault?: HandledError["fault"];
  } = {
    path,
    type,
    duration,
    userAgent,
    statusCode,
  };

  if (!result.ok) {
    logData.error = result.error;

    // Derive HTTP status from the TRPCError code, not ctx.res.statusCode.
    // The response status hasn't been set yet at middleware time — tRPC sets
    // it later when serializing the response. So we map it ourselves.
    const resolvedStatus =
      result.error instanceof TRPCError ? getHTTPStatusCodeFromError(result.error) : 500;

    const cause = result.error instanceof TRPCError ? result.error.cause : undefined;
    // isHandled also matches an instance from a second copy of the package,
    // which bare `instanceof` misses — see its brand check.
    const handledCause = HandledError.isHandled(cause) ? cause : undefined;

    // A handled error states its own status, and it is the accurate one: tRPC
    // v10 has no code for 502/503/504, so an upstream failure resolves to 500
    // through `handledErrorToTRPCCode` and would otherwise be counted against
    // our own error budget every time a customer typos a base URL.
    logData.statusCode = handledCause?.httpStatus ?? resolvedStatus;

    // Include handled error code + fault in log data for structured
    // filtering (and spike alerting on handledErrorCode).
    if (handledCause) {
      logData.handledErrorCode = handledCause.code;
      logData.handledErrorFault = handledCause.fault;
    }

    // Only unhandled 5xx errors are captured as exceptions: handled errors
    // are expected failure modes with typed causes, not bugs.
    if (resolvedStatus >= 500 && !handledCause) {
      capture(result.error);
    }

    // Handled errors log by fault attribution, not status: customer-fault
    // errors are expected (warn — watched for spikes), while platform and
    // provider failures are incidents worth an error line. Unhandled errors
    // stay status-based.
    const logLevel = handledCause
      ? handledCause.fault === "customer"
        ? "warn"
        : "error"
      : getLogLevelFromStatusCode(resolvedStatus);
    log[logLevel](logData, "trpc call");
    return;
  }

  // The call succeeded, so this is not a failure and the record carries no
  // cause. It is raised only because the time it took is worth watching by
  // rate, which is what warning means here.
  if (slowCallBudgetMs > 0 && duration > slowCallBudgetMs) {
    const suppressed = slowCallThrottle.claim({ key: path, now });
    if (suppressed !== undefined) {
      log.warn(
        {
          ...logData,
          budgetMs: slowCallBudgetMs,
          suppressedSincePrevious: suppressed,
        },
        "trpc call",
      );
      return;
    }
  }

  log.info(logData, "trpc call");
}

/**
 * Routers whose calls flood the request log without being useful for
 * debugging: presence (peer cursor / drawer presence heartbeats fire
 * every few seconds per open tab). Logging + tracing them buries the
 * signal in noise. Errors are still reported by the middlewares below.
 */
const SILENCED_LOG_PATH_PREFIXES = ["presence."] as const;

/**
 * tRPC call types whose volume is unbounded — SSE subscriptions emit
 * a "trpc call" log line per delivered message. Silencing the
 * subscription type as a whole keeps the dev log readable without
 * sprinkling per-router opt-outs across the codebase.
 */
const SILENCED_LOG_TYPES = new Set(["subscription"]);

function isSilencedPath(path: string): boolean {
  return SILENCED_LOG_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function isSilencedCall({ path, type }: { path: string; type: string }): boolean {
  return isSilencedPath(path) || SILENCED_LOG_TYPES.has(type);
}

/**
 * Records one finished tRPC call: decides whether it is logged at all, then
 * how loudly.
 *
 * The two halves belong together. Silencing runs first and drops the record
 * entirely, so "a slow presence heartbeat raises nothing" is a property of the
 * pair and of neither alone. Asserting it against the classifier proves only
 * that a boolean is what it is, and asserting it against the logger tests a
 * call the middleware never makes. This is the seam that can be asked the real
 * question.
 */
export function recordTrpcCall(args: Parameters<typeof handleTrpcCallLogging>[0]): void {
  // Errors are still reported on a silenced path: the volume that earns the
  // silence is happy-path volume, and a failing heartbeat is worth seeing.
  if (isSilencedCall({ path: args.path, type: args.type }) && args.result.ok) {
    return;
  }
  handleTrpcCallLogging(args);
}
