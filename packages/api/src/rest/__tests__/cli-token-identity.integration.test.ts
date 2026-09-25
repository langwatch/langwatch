import { moduleApi } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { anyAuthenticated } from "../../access/access.ts";
import { OrganizationInvalidCredentialsError } from "../../errors.ts";
import { redactAuditArgs } from "../../trpc/audit.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { CliTokenIdentity, type CliTokenPresented } from "../cli-token-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";
import type { RestAuditRow } from "../runtime.ts";

const NOW = Date.parse("2026-09-25T12:00:00Z");

type WhoAmI = { userId: string; organizationId: string; session: unknown };

const Api = moduleApi<{ whoAmI(input: WhoAmI): WhoAmI }>()("governance");

const declaration = defineRestRouter(Api)
  .withNamespace("cli-token")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("cliToken")
  .get("/api/cli-token/me", "cliTokenMe")
  .withAudit("cli-token.me")
  .withAccess(anyAuthenticated({ reason: "the CLI token door fixture" }))
  .withOutput(z.object({ userId: z.string(), organizationId: z.string(), session: z.unknown() }))
  .handle(({ app, actor, scope }) =>
    app.whoAmI({ userId: actor.id, organizationId: scope.id, session: actor.cliSession }),
  )
  .build();

/** The owning module's sessions: one live, one expired, one revoked. */
const SESSIONS = new Map([
  ["lw_at_live", { expiresAt: NOW + 60_000, revoked: false }],
  ["lw_at_old", { expiresAt: NOW - 1, revoked: false }],
  ["lw_at_revoked", { expiresAt: NOW + 60_000, revoked: true }],
]);

function hostWith(presented: CliTokenPresented[], audited: RestAuditRow[] = []) {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async (row) => void audited.push(row) },
  });
  const door = CliTokenIdentity.create({
    verify: async (key) => {
      presented.push(key);
      const token = key.authorization.slice("Bearer ".length);
      const session = SESSIONS.get(token);
      if (!session || session.revoked || session.expiresAt <= NOW) {
        throw new OrganizationInvalidCredentialsError();
      }

      return {
        userId: "user-1",
        organizationId: "org-1",
        tokenKey: `lwcli:access:${token}`,
        cliApiKeyId: "key-1",
        clientInfo: { deviceLabel: "laptop", hostname: "host-1" },
      };
    },
  });
  host.mount(declaration.router(), () => ({ whoAmI: (input: WhoAmI) => input }), {
    facts: [bindRestCredential("cliToken", () => door)],
  });

  return host;
}

describe("the CLI token door", () => {
  describe("given a live device-session bearer", () => {
    it("puts the person, their organization and the session on the request", async () => {
      const presented: CliTokenPresented[] = [];
      const response = await hostWith(presented).app.request("/api/cli-token/me", {
        headers: { authorization: "Bearer lw_at_live" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        userId: "user-1",
        organizationId: "org-1",
        session: {
          tokenKey: "lwcli:access:lw_at_live",
          cliApiKeyId: "key-1",
          clientInfo: { deviceLabel: "laptop", hostname: "host-1" },
        },
      });
      expect(presented).toEqual([{ authorization: "Bearer lw_at_live" }]);
    });
  });

  describe("when the route is audited", () => {
    it("records the person's id and never the session's token key", async () => {
      const audited: RestAuditRow[] = [];
      const response = await hostWith([], audited).app.request("/api/cli-token/me", {
        headers: { authorization: "Bearer lw_at_live" },
      });

      expect(response.status).toBe(200);
      expect(audited).toMatchObject([{ actorId: "user-1", action: "cli-token.me" }]);
      expect(JSON.stringify(audited)).not.toContain("lw_at_live");
    });

    it("masks the token key by name when an actor rides in the audited arguments", () => {
      const actor = {
        type: "user",
        id: "user-1",
        cliSession: { tokenKey: "lwcli:access:lw_at_live", cliApiKeyId: "key-1" },
      };

      const redacted = JSON.stringify(redactAuditArgs({ input: { actor } }));

      expect(redacted).not.toContain("lw_at_live");
      expect(redacted).toContain("key-1");
    });
  });

  describe.each([
    ["an expired", "Bearer lw_at_old"],
    ["a revoked", "Bearer lw_at_revoked"],
    ["a malformed", "Bearer not-a-cli-token"],
  ])("given %s bearer", (_label, authorization) => {
    it("refuses with the owning module's code", async () => {
      const response = await hostWith([]).app.request("/api/cli-token/me", {
        headers: { authorization },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe.each([
    ["no Authorization header", {}],
    ["a Basic header", { authorization: "Basic bHdfYXRfbGl2ZQ==" }],
  ])("given %s", (_label, headers: Record<string, string>) => {
    it("refuses as missing credentials without asking the module", async () => {
      const presented: CliTokenPresented[] = [];
      const response = await hostWith(presented).app.request("/api/cli-token/me", { headers });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
      expect(presented).toEqual([]);
    });
  });

  describe("given a family no module bound a CLI token for", () => {
    it("lets nobody in", async () => {
      const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
      const host = RestHost.create({
        identities: {
          project: closed,
          organization: closed,
          apiKey: closed,
          scimToken: closed,
          "instance-admin": closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
      });
      host.mount(declaration.router(), () => ({ whoAmI: (input: WhoAmI) => input }));

      const response = await host.app.request("/api/cli-token/me", {
        headers: { authorization: "Bearer lw_at_live" },
      });

      expect(response.status).toBe(404);
    });
  });
});
