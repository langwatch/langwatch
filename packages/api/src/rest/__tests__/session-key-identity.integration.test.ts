import { moduleApi } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { anyAuthenticated } from "../../access/access.ts";
import { ProjectInvalidCredentialsError } from "../../errors.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";
import { SessionKeyIdentity, type SessionKeyPresented } from "../session-key-identity.ts";

const INSTANCE_HEADER = "x-agent-instance-token";
const NOW = Date.parse("2026-09-25T12:00:00Z");

const Api = moduleApi<{
  whoAmI(input: { actorId: string | null; projectId: string }): {
    actorId: string | null;
    projectId: string;
  };
}>()("langy");

const declaration = defineRestRouter(Api)
  .withNamespace("session-key")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("sessionKey")
  .get("/api/session-key/me", "sessionKeyMe")
  .withAccess(anyAuthenticated({ reason: "the session key door fixture" }))
  .withOutput(z.object({ actorId: z.string().nullable(), projectId: z.string() }))
  .handle(({ app, actor, scope }) =>
    app.whoAmI({ actorId: actor && "id" in actor ? actor.id : null, projectId: scope.id }),
  )
  .build();

/** The minting module's keys: one live, one past its expiry. */
const MINTED = new Map([
  ["sk-lw-session-live", { userId: "user-1", projectId: "project-1", expiresAt: NOW + 60_000 }],
  ["sk-lw-session-old", { userId: "user-1", projectId: "project-1", expiresAt: NOW - 1 }],
]);

function hostWith(presented: SessionKeyPresented[]) {
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
  const door = SessionKeyIdentity.create({
    instanceTokenHeader: INSTANCE_HEADER,
    verify: async (key) => {
      presented.push(key);
      const minted = MINTED.get(key.token);
      if (!minted || minted.expiresAt <= NOW || minted.projectId !== key.projectId) {
        throw new ProjectInvalidCredentialsError();
      }

      return { actor: { type: "user", id: minted.userId }, projectId: minted.projectId };
    },
  });
  host.mount(
    declaration.router(),
    () => ({ whoAmI: (input: { actorId: string | null; projectId: string }) => input }),
    {
      facts: [bindRestCredential("sessionKey", () => door)],
    },
  );

  return host;
}

describe("the session key door", () => {
  describe("given a live minted key for its project", () => {
    it("puts the key's holder and project on the request", async () => {
      const presented: SessionKeyPresented[] = [];
      const response = await hostWith(presented).app.request("/api/session-key/me", {
        headers: {
          authorization: "Bearer sk-lw-session-live",
          "x-project-id": "project-1",
          [INSTANCE_HEADER]: "lcs_instance",
        },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ actorId: "user-1", projectId: "project-1" });
      expect(presented).toEqual([
        { token: "sk-lw-session-live", projectId: "project-1", instanceToken: "lcs_instance" },
      ]);
    });
  });

  describe("given no key", () => {
    it("refuses as missing credentials without asking the module", async () => {
      const presented: SessionKeyPresented[] = [];
      const response = await hostWith(presented).app.request("/api/session-key/me");

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
      expect(presented).toEqual([]);
    });
  });

  describe("given a key the module did not mint", () => {
    it("refuses with the module's own code", async () => {
      const response = await hostWith([]).app.request("/api/session-key/me", {
        headers: { authorization: "Bearer sk-lw-guessed", "x-project-id": "project-1" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe("given a minted key past its expiry", () => {
    it("refuses with the module's own code", async () => {
      const response = await hostWith([]).app.request("/api/session-key/me", {
        headers: { authorization: "Bearer sk-lw-session-old", "x-project-id": "project-1" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe("given a family no module bound a session key for", () => {
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
      host.mount(declaration.router(), () => ({
        whoAmI: (input: { actorId: string | null; projectId: string }) => input,
      }));

      const response = await host.app.request("/api/session-key/me", {
        headers: { authorization: "Bearer sk-lw-session-live", "x-project-id": "project-1" },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not_found" });
    });
  });
});
