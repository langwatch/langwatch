/** The address a signed-out tRPC request is keyed on: the resolved one, never a header. */

import { describe, expect, it } from "vitest";

import { SessionReader } from "../../hosting/session-reader.ts";
import { ClientAddress } from "../../policy/client-address.ts";
import { TrpcHost } from "../host.ts";

const refuse = () => Promise.reject(new Error("no decision is asked here"));

describe("the context a signed-out tRPC request runs in", () => {
  it("keys on the socket address the resolver chose, though a forwarding header arrived", async () => {
    const trpc = TrpcHost.create({
      sessions: SessionReader.unverified(),
      authz: { getDecision: refuse, getProjectAnyDecision: refuse, checkScopeLineage: refuse },
    });

    const addresses = ClientAddress.fromTrustedProxies({ addresses: [] });
    const request = new Request("http://api.test/api/trpc/account.register", {
      headers: { "x-forwarded-for": "198.51.100.7" },
    });

    const address = addresses.of({
      header: (name) => request.headers.get(name) ?? undefined,
      socketAddress: "192.0.2.10",
    });

    const context = await trpc.context({ request, address });

    expect(context.tryActor()).toBeUndefined();
    expect(context.clientIp()).toBe("192.0.2.10");
    expect(context.clientIp()).not.toBe("unknown");
  });
});
