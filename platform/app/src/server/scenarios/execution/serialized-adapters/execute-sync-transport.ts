/**
 * How a code or workflow target's one `execute_flow` POST reaches nlpgo.
 *
 * Both adapters build the same request and then read the same three things off
 * the answer: `ok`, `status`, and the body as text. Every failure they report
 * is derived from those, so the transport's whole contract is to deliver them
 * and to let a transport failure propagate unwrapped. Classification stays in
 * the adapters, where it already is.
 *
 * Two routes, and the parent picks:
 *
 * - `direct` posts to the engine itself at `LANGWATCH_NLP_SERVICE`, carrying
 *   the engine's internal secret. This is what a self-hosted install does, and
 *   it is unchanged.
 * - `relay` posts to the control plane, carrying the project's own key. The
 *   control plane then reaches that project's engine. This is what SaaS does,
 *   where each project has its own Lambda and invoking it needs an AWS
 *   credential that may invoke ANY project's function. That credential stays
 *   in the control plane; the child never holds it.
 *
 * The in-process transport, for a caller already running inside the control
 * plane, is deliberately in a different module: this one is bundled into the
 * scenario child (`scripts/build-server.mjs`, entry
 * `scenario-child-process.ts`), and the control plane's route to nlpgo pulls
 * in the AWS SDK and Prisma. See `~/server/nlpgo/inProcessExecuteSyncTransport.ts`.
 */

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import { fetch as undiciFetch } from "undici";
import { nlpgoInternalHeaders } from "../../../nlpgo/internalSecret";
import {
  createNlpFetchDispatcher,
  type FetchInitWithDispatcher,
} from "../../../nlpgo/timeouts";
import type { ExecuteSyncRoute } from "../types";

/** The engine's own path for a synchronous studio execution. */
export const EXECUTE_SYNC_ENGINE_PATH = "/go/studio/execute_sync";

/** The control plane's path for the same, authenticated by a project key. */
export const EXECUTE_SYNC_RELAY_PATH = "/api/scenario/execute-sync";

/**
 * nlpgo's answer to one POST, narrowed to what the adapters read.
 *
 * `text` is read exactly once by the callers: `json()` consumes the stream, so
 * a `json()`-then-`text()` fallback can never recover a non-JSON payload and
 * the customer is shown an empty body instead of the real one (lw#3439).
 */
export type ExecuteSyncResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export interface ExecuteSyncTransport {
  /** Named on the span and in every error, so a failure says where it went. */
  readonly endpoint: string;
  /**
   * Posts one event and answers what nlpgo answered.
   *
   * Throws the transport's own failure unwrapped. The adapters classify it,
   * because only they know whether their own deadline is what fired.
   */
  post(opts: {
    event: unknown;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<ExecuteSyncResponse>;
}

/**
 * A transport that posts over HTTP with the caller's deadline on the
 * dispatcher.
 *
 * undici's `headersTimeout` and `bodyTimeout` (300s each) live on the
 * dispatcher, not on the request, so an `AbortController` alone cannot raise
 * them. That is what cut a 630s deadline off at 300s in production. The
 * dispatcher may only be given to the `fetch` exported by `undici`: Node's
 * global `fetch` is bound to the undici bundled with the runtime and rejects
 * this package's dispatcher with "invalid onRequestStart method".
 */
function httpExecuteSyncTransport({
  endpoint,
  headers,
}: {
  endpoint: string;
  /** Read per call, so a value that is resolved at request time stays so. */
  headers: () => Record<string, string>;
}): ExecuteSyncTransport {
  return {
    endpoint,
    async post({ event, signal, timeoutMs }) {
      const fetchInit: FetchInitWithDispatcher = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers(),
        },
        body: JSON.stringify(event),
        signal,
        dispatcher: createNlpFetchDispatcher({ timeoutMs }),
      };
      return await undiciFetch(endpoint, fetchInit);
    },
  };
}

/** Posts straight to the engine, the way a self-hosted install does. */
export function directExecuteSyncTransport({
  nlpServiceUrl,
}: {
  nlpServiceUrl: string;
}): ExecuteSyncTransport {
  return httpExecuteSyncTransport({
    endpoint: `${nlpServiceUrl.replace(/\/$/, "")}${EXECUTE_SYNC_ENGINE_PATH}`,
    headers: () => nlpgoInternalHeaders(),
  });
}

/**
 * Posts to the control plane, which reaches this project's own engine.
 *
 * The credential is the project's platform key, the same one the adapters
 * already carry to put `api_key` in the DSL and the same one the connected
 * agent adapter presents as `X-Auth-Token`. Nothing new reaches the child.
 *
 * `traceparent` goes with it so the control plane's span for this hop joins
 * the child's trace rather than starting its own. It is a header on THIS hop
 * only: the hop from the control plane to nlpgo stays as it is, since these
 * runs set `do_not_trace` and the engine emits no spans for them.
 */
export function relayExecuteSyncTransport({
  relayBaseUrl,
  projectApiKey,
}: {
  relayBaseUrl: string;
  projectApiKey: string;
}): ExecuteSyncTransport {
  return httpExecuteSyncTransport({
    endpoint: `${relayBaseUrl.replace(/\/$/, "")}${EXECUTE_SYNC_RELAY_PATH}`,
    headers: () => {
      const { headers } = injectTraceContextHeaders({ headers: {} });
      return {
        "X-Auth-Token": projectApiKey,
        ...(headers.traceparent ? { traceparent: headers.traceparent } : {}),
      };
    },
  });
}

/**
 * The transport for a target running in the scenario child, from the route the
 * parent chose.
 *
 * A job queued before the route existed carries none, and falls back to the
 * direct engine URL it has always carried. That is what lets a deploy drain
 * its queue instead of failing every in-flight run.
 */
export function childExecuteSyncTransport({
  route,
  nlpServiceUrl,
  projectApiKey,
}: {
  route: ExecuteSyncRoute | undefined;
  nlpServiceUrl: string;
  projectApiKey: string;
}): ExecuteSyncTransport {
  if (route?.mode === "relay") {
    return relayExecuteSyncTransport({
      relayBaseUrl: route.relayBaseUrl,
      projectApiKey,
    });
  }
  return directExecuteSyncTransport({
    nlpServiceUrl:
      route?.mode === "direct" ? route.nlpServiceUrl : nlpServiceUrl,
  });
}
