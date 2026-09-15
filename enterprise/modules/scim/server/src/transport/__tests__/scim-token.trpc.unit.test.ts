// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The `scimToken.*` procedures over the real runtime and a real `ScimApp`.
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { createTrpcRuntime, type TrpcRuntimePorts } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { scimTokenTrpcTransport } from "../scim-token.trpc.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

type ScimTrpcTestContext = { actor: { id: string } };

function testPorts(permits: (permission: string) => boolean): TrpcRuntimePorts<ScimTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

class TokenDirectoryFake extends ScimServiceFake {
  override readonly listTokens = vi.fn(async () => []);
  override readonly generateToken = vi.fn(async () => ({
    token: "scim_secret",
    tokenId: "token_1",
    connectionId: "ssoconn_1",
  }));
  override readonly revokeToken = vi.fn(async () => ({ success: true }) as const);
}

function mount(options: { permits?: (permission: string) => boolean } = {}) {
  const scim = new TokenDirectoryFake();
  const { app } = scimTestApp({ scim });
  const trpc = initTRPC.context<ScimTrpcTestContext>().create();
  const router = createTrpcRuntime<ScimTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: testPorts(options.permits ?? (() => true)),
  }).mount(scimTokenTrpcTransport, () => app);

  return { scim, router, caller: router.createCaller({ actor: { id: "user-1" } }) };
}

describe("the scimToken tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the settings page calls", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "generate",
        "list",
        "revoke",
      ]);
    });

    it("reads with a query and changes with a mutation", () => {
      const { router } = mount();
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({ list: "query", generate: "mutation", revoke: "mutation" });
    });
  });

  describe("given a caller holding organization:manage", () => {
    describe("when a token is minted for a connection", () => {
      it("passes the connection through, and answers the secret once", async () => {
        const { caller, scim } = mount();

        await expect(
          caller.generate({ organizationId: "org_1", connectionId: "ssoconn_1" }),
        ).resolves.toEqual({
          token: "scim_secret",
          tokenId: "token_1",
          connectionId: "ssoconn_1",
        });
        expect(scim.generateToken).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: "org_1", connectionId: "ssoconn_1" }),
        );
      });
    });
  });

  describe("given a caller who may only read the organization", () => {
    describe("when a token is minted", () => {
      it("refuses the mint, because minting is the authority to invite anybody", async () => {
        const { caller, scim } = mount({
          permits: (permission) => permission === "organization:view",
        });

        await expect(caller.generate({ organizationId: "org_1" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(scim.generateToken).not.toHaveBeenCalled();
      });
    });
  });
});
