// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DiscoveryError } from "@better-auth/sso";
import { type Agent, fetch as undiciFetch } from "undici";
import {
  type HostResolver,
  pinnedTo,
  publicHopFor,
  systemHostResolver,
} from "~/server/app-layer/identity/public-egress";

export type OidcTransport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: ArrayBuffer;
    signal: AbortSignal;
    redirect: "manual";
    dispatcher: Agent;
  },
) => Promise<
  Pick<Response, "status" | "statusText" | "arrayBuffer"> & {
    headers: Iterable<[string, string]>;
  }
>;

// Better Auth owns origin, endpoint, state, PKCE, and redirect validation.
// This transport only adds LangWatch's deployment-specific egress policy.
export function createSsoOidcFetch({
  dialableInternalOrigins,
  resolveHost = systemHostResolver,
  fetchImpl = undiciFetch,
}: {
  dialableInternalOrigins: string[];
  resolveHost?: HostResolver;
  fetchImpl?: OidcTransport;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const judged = await publicHopFor({
      url: request.url,
      resolveHost,
      dialableInternalOrigins,
    });
    if (!judged.ok) {
      throw new DiscoveryError(
        "discovery_private_host",
        "oidc endpoint refused by egress policy",
      );
    }

    const dispatcher = pinnedTo(judged.addresses);
    try {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        ...(request.body === null ? {} : { body: await request.arrayBuffer() }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
        redirect: "manual",
        dispatcher,
      });
      const body = await response.arrayBuffer();
      return new Response(body.byteLength === 0 ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
      });
    } finally {
      await dispatcher.destroy();
    }
  };
}
