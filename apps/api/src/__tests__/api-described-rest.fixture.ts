import type { RestIdentity } from "@langwatch/api/hosting";
import { RestHost } from "@langwatch/api/rest";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";

import { describedMiddlewareContexts } from "../openapi-document.ts";
import { bootApi } from "./api-installation.fixture.ts";

/** Describing routes needs no credential: every door refuses, every middleware context throws. */
export async function bootDescribedRest() {
  const refuse = () => {
    throw new Error("the test describes routes and answers no request");
  };
  const closed: RestIdentity = {
    authenticate: refuse,
    identify: refuse,
    identifyOptional: refuse,
    authorize: refuse,
    authorizePlatform: refuse,
  };
  let rest: RestHost | undefined;
  const { runtime } = await bootApi({
    surface: () => {
      rest = RestHost.create({
        authz: restTestAuthorization().forRequest(),
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
        idempotency: refuse,
        rateLimiter: { check: refuse },
        middlewareContext: describedMiddlewareContexts() as never,
        entitlements: { holds: refuse },
      });
      const mountNothing = { mount: () => {} };

      return {
        hosts: { rest, trpc: mountNothing, websocket: mountNothing, rawhttp: mountNothing },
        serve: () => void 0,
      } as never;
    },
  });

  if (!rest) throw new Error("the api booted without a REST host");

  return { runtime, rest };
}
