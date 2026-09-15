/**
 * The api's tRPC door, over a real declared namespace.
 *
 * The declaration is `modules/authz`'s own — the exemplar the conversion is
 * measured against — rather than a fixture, because what this proves is that a
 * module's inert declaration reaches the wire through the process's root: a
 * fixture would prove only that the host can mount a fixture.
 */
import { authzTrpcTransport } from "@langwatch/authz-server";
import type { DependencyToken, TransportPeers } from "@langwatch/runtime-composition";
import { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { ApiTrpcHost, type ApiTrpcSession } from "../api-trpc.host.ts";

const SIGNED_IN: ApiTrpcSession = {
  user: { id: "user-1", email: "person@example.com" },
  sessionId: "session-1",
};

const authz = {
  getDecision: async () => ({ allowed: true }) as never,
  getProjectAnyDecision: async () => ({ allowed: true }) as never,
  checkScopeLineage: async () => ({ kind: "consistent" }) as never,
  effectivePermissionsFor: async () => ({ permissions: ["project:view"] }) as never,
};

function peers(): TransportPeers {
  return {
    app: <Instance>(token: DependencyToken<Instance>): Instance => {
      if (token === (AuthzApi as unknown as DependencyToken<Instance>)) {
        return authz as unknown as Instance;
      }
      throw new Error(`unexpected peer: ${String(token)}`);
    },
    find: () => undefined,
  };
}

function host(session: ApiTrpcSession | null) {
  const door = ApiTrpcHost.create({
    peers: peers(),
    config: { browserSession: async () => session, logger: { warn: () => void 0, error: () => void 0 } },
  });

  return door.door({ authz: door.mount(authzTrpcTransport, () => authz) });
}

describe("given the api's tRPC door over one declared namespace", () => {
  describe("when a signed-in caller asks a declared procedure", () => {
    it("answers on the address the browser has always used", async () => {
      const response = await host(SIGNED_IN).request(
        "/api/trpc/authz.effectivePermissions?input=" +
          encodeURIComponent(JSON.stringify({ json: { projectId: "project-1" } })),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("when nobody is signed in", () => {
    it("refuses rather than answering", async () => {
      const response = await host(null).request(
        "/api/trpc/authz.effectivePermissions?input=" +
          encodeURIComponent(JSON.stringify({ json: { projectId: "project-1" } })),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("when the path names no procedure this process serves", () => {
    it("does not answer it out of some other namespace", async () => {
      const response = await host(SIGNED_IN).request("/api/trpc/nothing.here");

      expect(response.status).toBe(404);
    });
  });

  describe("when the stream lane is asked for a procedure that is not a subscription", () => {
    it("refuses before it resolves a caller", async () => {
      const response = await host(SIGNED_IN).request("/api/sse/authz.effectivePermissions");

      expect(response.status).not.toBe(200);
    });
  });
});
