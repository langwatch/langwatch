import type { RestIdentity } from "@langwatch/api/hosting";
import { RestHost } from "@langwatch/api/rest";

import { processModules } from "../process-modules.generated.ts";
import { bootApi } from "./api-installation.fixture.ts";

/** Describing the routes needs no credential, so every door refuses and every fact throws. */
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
  const facts = new Map<string, { middleware: { name: string }; resolve: () => never }>();

  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "rest") continue;

      const declaration = transport.router() as {
        routes: readonly { middleware?: readonly { name: string }[] }[];
      };

      for (const route of declaration.routes) {
        for (const fact of route.middleware ?? []) {
          facts.set(fact.name, { middleware: fact, resolve: refuse });
        }
      }
    }
  }

  let rest: RestHost | undefined;
  const { runtime } = await bootApi({
    surface: () => {
      rest = RestHost.create({
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          scim_token: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
        idempotency: refuse,
        rateLimiter: { check: refuse },
        facts: [...facts.values()] as never,
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
