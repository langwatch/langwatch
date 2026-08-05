/**
 * Ingest for browser telemetry: `POST /api/rum/v1/traces`.
 *
 * The browser exports OTLP here rather than to the collector directly. That is
 * deliberate — production keeps OTLP off the internet, and the collector's
 * bearer filter guards only its traces pipeline, so exposing it would also
 * expose an unauthenticated log sink. Proxying through the app's own origin
 * means no CORS and no new internet-facing infrastructure.
 *
 * The route stays thin: read the body under a cap, name the caller, hand both
 * to the service. Everything the payload is allowed to cost or claim is decided
 * in `rum-ingest.service.ts`.
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */

import { HandledError } from "@langwatch/handled-error";
import { RUM_SESSION_HEADER, RUM_TRACES_PATH } from "@langwatch/react-rum";
import type { Context } from "hono";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import {
  ingestBrowserTraces,
  readCappedBody,
} from "~/server/rum/rum-ingest.service";

const secured = createServiceApp({ basePath: "/api/rum" });

/**
 * Names the caller for the per-caller rate-limit bucket.
 *
 * Both inputs are self-asserted — the session header is whatever the browser
 * chose, and `x-forwarded-for` is only trustworthy from the hop nearest us
 * (which is why this reads the *last* entry: earlier ones are supplied by the
 * client and appended to by each proxy). Neither can be relied on to identify
 * an abuser, which is why the service also enforces a global cap.
 */
export const rateLimitKey = (c: Context): string => {
  const session = c.req.header(RUM_SESSION_HEADER);
  if (session) return `session:${session.slice(0, 64)}`;

  const hops = c.req.header("x-forwarded-for")?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();
  return `ip:${nearest ?? "unknown"}`;
};

secured
  .access(
    publicEndpoint(
      "Browser telemetry ingest; the browser has no credential to present and the payload is treated as untrusted",
    ),
  )
  .post(RUM_TRACES_PATH.replace("/api/rum", ""), async (c) => {
    try {
      const body = await readCappedBody(c.req.raw);
      await ingestBrowserTraces({ body, callerKey: rateLimitKey(c) });
    } catch (error) {
      if (HandledError.isHandled(error)) {
        return c.json(
          { error: error.message, code: error.code },
          error.httpStatus as 400 | 404 | 413 | 429 | 500,
        );
      }
      throw error;
    }

    return c.body(null, 202);
  });

export const app = secured.hono;
