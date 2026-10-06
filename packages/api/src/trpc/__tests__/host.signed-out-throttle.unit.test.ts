/**
 * The bucket a signed-out procedure is counted in: the address the door resolved, else a bucket
 * of its own. Spec: specs/security/api-spine-hardening.feature.
 */

import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/index.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import { ClientAddress } from "../../policy/client-address.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface AccountApi {
  register(input: { email: string }): { id: string };
}

const AccountApi = moduleApi<AccountApi>()("auth");

const register = defineTrpcRouter(
  AccountApi,
  defineTrpcContract("account")
    .mutation("register")
    .withInput(z.object({ email: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .build(),
)
  .procedure("register")
  .withAccess(publicRoute({ reason: "signing up predates the account it creates" }))
  .handle(({ app, input }) => app.register(input))
  .build();

function served() {
  const keys: string[] = [];
  const refuse = () => Promise.reject(new Error("no decision is asked here"));

  const trpc = TrpcHost.create({
    sessions: SessionReader.unverified(),
    authz: { getDecision: refuse, getProjectAnyDecision: refuse, checkScopeLineage: refuse },
    throttle: {
      limiter: {
        check: async (key) => {
          keys.push(key);

          return { allowed: true };
        },
      },
      policies: { "account.register": { requests: 5, seconds: 60 } },
    },
  });
  trpc.mount(composeTrpcRouters("account", [register]), () => ({ register: () => ({ id: "u1" }) }));

  const call = async ({ address }: { address?: string }) => {
    const request = new Request(`http://api.test${TrpcHost.path}/account.register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ email: "a@example.com" }),
    });
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => trpc.context({ request, ...(address ? { address } : {}) }),
    });

    return response.status;
  };

  return { call, keys };
}

describe("the per-address key of a signed-out procedure", () => {
  /** @scenario "The signed-out tRPC surface keys on the resolved address" */
  it("counts the socket address the resolver chose, never the forwarding header", async () => {
    const { call, keys } = served();
    const addresses = ClientAddress.fromTrustedProxies({ addresses: [] });
    const address = addresses.of({
      header: (name) => (name === "x-forwarded-for" ? "198.51.100.7" : undefined),
      socketAddress: "192.0.2.10",
    });

    expect(await call({ address })).toBe(200);

    expect(keys).toEqual(["throttle:account.register:192.0.2.10"]);
    expect(keys[0]).not.toContain("unknown");
  });

  /** @scenario "A caller whose address cannot be resolved gets its own bucket" */
  it("counts a call with no address to read in a bucket no resolved caller shares", async () => {
    const { call, keys } = served();

    expect(await call({})).toBe(200);
    expect(await call({ address: "192.0.2.10" })).toBe(200);

    expect(keys).toEqual([
      "throttle:account.register:anonymous",
      "throttle:account.register:192.0.2.10",
    ]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).not.toContain("unknown");
  });
});
