/**
 * Ingest for browser telemetry: `POST /api/rum/v1/traces`, proxied through
 * the app's own origin so production keeps OTLP off the internet. Route
 * stays thin; `rum-ingest.service.ts` decides cost and claims. See ADR-058.
 */

import { HandledError } from "@langwatch/handled-error";
import { RUM_SESSION_HEADER, RUM_TRACES_PATH } from "@langwatch/react-rum/constants";
import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { Context } from "hono";

import { ingestBrowserTraces, readCappedBody, type RumRateLimiter } from "./rum-ingest.service.ts";

/**
 * Names the caller for the per-caller rate-limit bucket. Both inputs are
 * self-asserted, so `x-forwarded-for` reads only the *last* hop (nearest us);
 * neither is reliable enough alone, hence the service's global cap too.
 */
export const rateLimitKey = (c: Context): string => {
  const session = c.req.header(RUM_SESSION_HEADER);
  if (session) return `session:${session.slice(0, 64)}`;

  const hops = c.req.header("x-forwarded-for")?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();
  return `ip:${nearest ?? "unknown"}`;
};

export function createRumRestApp(options: {
  security: AppRestSecurity;
  rateLimit: RumRateLimiter;
}): MountableRestApp {
  const { rateLimit } = options;
  const secured = options.security.createServiceApp({ basePath: "/api/rum" });

  secured
    .access(
      publicEndpoint(
        "Browser telemetry ingest; the browser has no credential to present and the payload is treated as untrusted",
      ),
    )
    .post(RUM_TRACES_PATH.replace("/api/rum", ""), async (c) => {
      try {
        const body = await readCappedBody(c.req.raw);
        await ingestBrowserTraces({ body, callerKey: rateLimitKey(c), rateLimit });
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

  return secured.mountable;
}
