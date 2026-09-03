/**
 * The canary round trip the /api/health probes are built on.
 *
 * A probe POSTs a synthetic trace back through our own public boundary and
 * waits for it to come out the other end; this module owns that leg — sending
 * it, deciding what counts as a failure, and saying so in a shape a monitor
 * can read. The routes keep request parsing and response serialization.
 *
 * @see specs/ops/health-probe-failures.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:health-probes:canary");

/**
 * A probe's canary work did not complete. `fault` is explicitly `platform`:
 * these endpoints exist for external monitors, and their 500 is a page about
 * US, never something the caller can remediate.
 *
 * `meta` is customer-visible — the REST boundary spreads it into the response
 * body — so it holds only what a monitor reads: which probe failed and on
 * which transport, so an alert names the broken half without anyone re-running
 * it by hand. Diagnostic detail belongs in the log line, not here.
 */
export class HealthCheckFailedError extends HandledError {
  declare readonly code: "health_check_failed";

  constructor({
    probe,
    transport,
    upstreamStatus,
    reasons,
  }: {
    /** Which probe: collector, processor, evaluations… */
    probe: string;
    /** Which leg of it: the REST boundary or the OTLP one. */
    transport?: CanaryTransport;
    upstreamStatus?: number;
    reasons?: readonly Error[];
  }) {
    super("health_check_failed", "The health check could not complete.", {
      httpStatus: 500,
      fault: "platform",
      meta: {
        check: probe,
        ...(transport !== void 0 ? { transport } : {}),
        ...(upstreamStatus !== void 0 ? { upstreamStatus } : {}),
      },
      ...(reasons ? { reasons } : {}),
    });
    this.name = "HealthCheckFailedError";
  }
}

/** Which boundary the canary was sent through. */
export type CanaryTransport = "rest" | "otlp";

/**
 * How long a canary POST may hang before the probe calls it a failure.
 *
 * Without it a wedged collector holds the socket open and the monitor sees no
 * answer at all, which is the one outcome a health check must never produce —
 * it has a code for this failure precisely so the alert can say what broke.
 */
const CANARY_TIMEOUT_MS = 30_000;

/**
 * One canary POST back through our own public boundary — that round trip is
 * what the probe checks. A network-level failure (connection refused, DNS, an
 * upstream that never answers) and a non-ok response are the same handled
 * outcome: the boundary did not take the canary, and that is ours.
 */
export async function sendCanary({
  probe,
  transport,
  url,
  authToken,
  body,
}: {
  probe: string;
  transport: CanaryTransport;
  url: string;
  authToken: string;
  body: unknown;
}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CANARY_TIMEOUT_MS),
    });
  } catch (error) {
    // Logged here and not left to the boundary: the wire masks a non-handled
    // reason to `unknown`, and pino renders an Error inside `reasons` as `{}`,
    // so this line is the only place the connection-refused / DNS / timeout
    // detail survives at all.
    logger.error({ probe, transport, url, error }, "Health canary transport failed");
    throw new HealthCheckFailedError({
      probe,
      transport,
      reasons: [error instanceof Error ? error : new Error(String(error))],
    });
  }
  if (!response.ok) {
    logger.error(
      { probe, transport, url, upstreamStatus: response.status },
      "Health canary refused by our own boundary",
    );
    throw new HealthCheckFailedError({
      probe,
      transport,
      upstreamStatus: response.status,
    });
  }
  return response;
}
