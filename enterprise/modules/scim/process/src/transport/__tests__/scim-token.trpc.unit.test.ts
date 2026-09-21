// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The `scimToken.*` procedures over the real runtime and a real `ScimApp`.
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { scimTokenTrpcTransport } from "../scim-token.trpc.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

type ScimTrpcTestContext = { actor: { id: string } };

function testPorts(
  permits: (permission: string) => boolean,
): TrpcRuntimeMembers<ScimTrpcTestContext> {
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

function mount(
  options: {
    permits?: (permission: string) => boolean;
    connections?: OrganizationSsoConnection[];
  } = {},
) {
  const scim = new TokenDirectoryFake();
  const { app } = scimTestApp({ scim, connections: options.connections });
  const trpc = initTRPC.context<ScimTrpcTestContext>().create();
  const router = createTrpcRuntime<ScimTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: testPorts(options.permits ?? (() => true)),
  }).mount(scimTokenTrpcTransport, () => app);

  return { scim, router, caller: router.createCaller({ actor: { id: "user-1" } }) };
}

describe("the scimToken tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the settings page calls", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "connections",
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

      expect(kinds).toEqual({
        list: "query",
        connections: "query",
        generate: "mutation",
        revoke: "mutation",
      });
    });
  });

  describe("given a caller holding sso:manage", () => {
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

  describe("given the organization holds directory connections", () => {
    describe("when the page asks which one a token could be minted against", () => {
      /** @scenario "The connections offered are the ones the identity module holds" */
      it("answers the connections identity holds, lifecycle state and all", async () => {
        const { caller } = mount({
          connections: [
            { connectionId: "ssoconn_1", displayName: "Okta", state: "ACTIVE" },
            { connectionId: "ssoconn_2", displayName: "Entra ID", state: "DRAFT" },
          ],
        });

        await expect(caller.connections({ organizationId: "org_1" })).resolves.toEqual([
          { connectionId: "ssoconn_1", displayName: "Okta", state: "ACTIVE" },
          { connectionId: "ssoconn_2", displayName: "Entra ID", state: "DRAFT" },
        ]);
      });
    });
  });

  describe("given a caller who may only read the organization", () => {
    describe("when the connections behind the mint are read", () => {
      it("refuses, because reading them takes seeing single sign-on", async () => {
        const { caller } = mount({
          permits: (permission) => permission === "organization:view",
          connections: [{ connectionId: "ssoconn_1", displayName: "Okta", state: "ACTIVE" }],
        });

        await expect(caller.connections({ organizationId: "org_1" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });
    });

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

  describe("given a reader who may see single sign-on but not manage it (ADR-122)", () => {
    const seeing = { permits: (permission: string) => permission === "sso:view" };

    it("reads the tokens, because listing them hands out no value", async () => {
      const { caller } = mount(seeing);

      await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([]);
    });

    it("reads the connections a token could be minted against", async () => {
      const { caller } = mount({
        ...seeing,
        connections: [{ connectionId: "ssoconn_1", displayName: "Okta", state: "ACTIVE" }],
      });

      await expect(caller.connections({ organizationId: "org_1" })).resolves.toEqual([
        { connectionId: "ssoconn_1", displayName: "Okta", state: "ACTIVE" },
      ]);
    });

    it("is offered no control: the mint and the revoke both take managing", async () => {
      const { caller, scim } = mount(seeing);

      await expect(caller.generate({ organizationId: "org_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.revoke({ organizationId: "org_1", tokenId: "token_1" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(scim.generateToken).not.toHaveBeenCalled();
      expect(scim.revokeToken).not.toHaveBeenCalled();
    });
  });
});
