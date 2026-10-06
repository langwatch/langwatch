/**
 * The address the shared-trace read is limited by: the one the door resolved, never a header.
 * Spec: specs/security/api-spine-hardening.feature
 */
import { SessionReader } from "@langwatch/api/hosting";
import { ClientAddress } from "@langwatch/api/policy";
import { bindTrpcFact, composeTrpcRouters, TrpcHost } from "@langwatch/api/trpc";
import { ShareReadRateLimitedError } from "@langwatch/share-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import { shareViewerFact, sharedTraceTrpcTransport } from "../shared-trace.trpc.ts";

type SharedTraceRead = Parameters<TraceApi["getSharedTrace"]>[0];

async function readShared({ socketAddress }: { socketAddress: string }): Promise<SharedTraceRead> {
  const reads: SharedTraceRead[] = [];
  const refuse = () => Promise.reject(new Error("no decision is asked here"));
  const trpc = TrpcHost.create({
    sessions: SessionReader.unverified(),
    authz: { getDecision: refuse, getProjectAnyDecision: refuse, checkScopeLineage: refuse },
  });
  trpc.mount(
    composeTrpcRouters("sharedTrace", [sharedTraceTrpcTransport]),
    () =>
      createApiFixture<TraceApi>({
        getSharedTrace: async (input) => {
          reads.push(input);
          throw new ShareReadRateLimitedError();
        },
      }),
    { facts: [bindTrpcFact(shareViewerFact, () => ({ userId: null, userAgent: null }))] },
  );

  const request = new Request(
    `http://api.test${TrpcHost.path}/sharedTrace.get?input=${encodeURIComponent(JSON.stringify({ token: "token-1" }))}`,
    {
      headers: { "x-forwarded-for": "198.51.100.7" },
    },
  );
  const address = ClientAddress.fromTrustedProxies({ addresses: [] }).of({
    header: (name) => request.headers.get(name) ?? undefined,
    socketAddress,
  });
  await fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request, address }),
  });

  const [read] = reads;
  if (!read) throw new Error("the shared trace read never reached the module");

  return read;
}

describe("the shared-trace read's caller address", () => {
  describe("when the socket peer is not a configured trusted proxy", () => {
    /** @scenario "The shared-trace limit reads the same resolver" */
    it("limits on the socket address and ignores the forwarding header the caller sent", async () => {
      const read = await readShared({ socketAddress: "192.0.2.10" });

      expect(read.clientIp).toBe("192.0.2.10");
      expect(read.clientIp).not.toBe("198.51.100.7");
    });
  });
});
