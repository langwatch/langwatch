/**
 * The execute_sync POST over HTTP: straight to the engine with its internal secret (self-hosted),
 * or to the control plane with the project key, which reaches that project's own engine (SaaS).
 * The credential that invokes per-project engines never reaches the child.
 * @see specs/scenarios/execute-sync-relay.feature
 */
import { type PrivateEndpointsHeaders } from "@langwatch/model-provider-contract";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import { nlpInternalSecretHeaders } from "@langwatch/process/nlp-internal-secret";
import { fetch as undiciFetch } from "undici";

import {
  EXECUTE_SYNC_ENGINE_PATH,
  EXECUTE_SYNC_RELAY_PATH,
  type ExecuteSyncTransport,
} from "../execute-sync.channel.ts";
import { type FetchInitWithDispatcher } from "../nlp-fetch.channel.ts";
import { HttpNlpFetchChannel } from "./http.nlp-fetch.channel.ts";

/** undici's own fetch: the dispatcher raising its 300s socket timeouts only works with it. */
function httpExecuteSyncTransport({
  endpoint,
  headers,
}: {
  endpoint: string;
  /** Read per call, so a value resolved at request time stays so. */
  headers: () => Record<string, string>;
}): ExecuteSyncTransport {
  return {
    endpoint,
    async post({ event, signal, timeoutMs }) {
      const fetchInit: FetchInitWithDispatcher = {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify(event),
        signal,
        dispatcher: HttpNlpFetchChannel.create().dispatcher({ timeoutMs }),
      };
      return undiciFetch(endpoint, fetchInit);
    },
  };
}

/**
 * Posts straight to the engine, the way a self-hosted install does. The organization's bound
 * hostnames (ADR-203), as the parent put them in the job, ride in the private endpoints header:
 * the engine reads bindings from that header alone, never from the event.
 */
export function directExecuteSyncTransport({
  nlpServiceUrl,
  nlpInternalSecret,
  privateEndpointsHeaders,
}: {
  nlpServiceUrl: string;
  nlpInternalSecret?: string | undefined;
  privateEndpointsHeaders?: PrivateEndpointsHeaders | undefined;
}): ExecuteSyncTransport {
  return httpExecuteSyncTransport({
    endpoint: `${nlpServiceUrl.replace(/\/$/, "")}${EXECUTE_SYNC_ENGINE_PATH}`,
    headers: () => ({
      ...nlpInternalSecretHeaders({ secret: nlpInternalSecret }),
      ...privateEndpointsHeaders,
    }),
  });
}

/**
 * Posts to the control plane with the project key; `traceparent` joins its span to this trace.
 * It sends no bindings: the control plane reads the organization's own and sets them itself.
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

/** Relays when the parent named a relay address for the job, else posts to the engine directly. */
export function childExecuteSyncTransport({
  relayBaseUrl,
  nlpServiceUrl,
  nlpInternalSecret,
  projectApiKey,
  privateEndpointsHeaders,
}: {
  relayBaseUrl: string | undefined;
  nlpServiceUrl: string;
  nlpInternalSecret?: string | undefined;
  projectApiKey: string;
  /** Sent on the direct route only; see {@link directExecuteSyncTransport}. */
  privateEndpointsHeaders?: PrivateEndpointsHeaders | undefined;
}): ExecuteSyncTransport {
  if (relayBaseUrl) return relayExecuteSyncTransport({ relayBaseUrl, projectApiKey });
  return directExecuteSyncTransport({ nlpServiceUrl, nlpInternalSecret, privateEndpointsHeaders });
}
