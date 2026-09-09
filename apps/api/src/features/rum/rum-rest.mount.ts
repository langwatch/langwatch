/**
 * Binds the browser telemetry intake to this process's own counter. The door
 * resolves no credential — a browser has none to present — so the payload is
 * treated as untrusted and the caller is named only for the rate-limit bucket.
 */
import { bindRestHeader, type MountableRestApp, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { RUM_SESSION_HEADER } from "@langwatch/react-rum/constants";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import {
  ingestBrowserTraces,
  readCappedBody,
  type RumRateLimiter,
} from "./rum-ingest.service.ts";
import { rumForwardedFor, rumRest, rumSession } from "./rum.rest.ts";

/** `/api/rum/v1/traces`, bound to one process's fixed-window counter. */
export function mountRumRest(
  runtime: ApiRestRuntime,
  options: { rateLimit: RumRateLimiter },
): MountableRestApp {
  return runtime.mount(
    rumRest.router(),
    () => ({
      acceptExport: async ({ request, callerKey }) => {
        const body = await readCappedBody(request);

        await ingestBrowserTraces({ body, callerKey, rateLimit: options.rateLimit });
      },
    }),
    {
      onError: rumErrors,
      facts: [
        bindRestHeader(rumSession, RUM_SESSION_HEADER),
        bindRestHeader(rumForwardedFor, "x-forwarded-for"),
      ],
    },
  );
}

/**
 * Every refusal this route raises, in the body the browser's exporter already
 * handles. Anything else collapses to the flat 500 the process publishes: an
 * unanticipated failure never puts its own message in front of a caller.
 */
const rumErrors: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json(
      { error: error.message, code: error.code },
      error.httpStatus as ContentfulStatusCode,
    );
  }

  return context.json(
    { error: "Internal Server Error", message: "An unknown error occurred" },
    500,
  );
};
