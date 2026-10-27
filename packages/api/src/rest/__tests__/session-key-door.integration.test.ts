import type { SessionKeyPresented } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "../../errors.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { defineRestDoor } from "../door.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

const INSTANCE_HEADER = "x-agent-instance-token";
const NOW = Date.parse("2026-09-25T12:00:00Z");

type Holder = Readonly<{ actor: { type: "user"; id: string }; projectId: string }>;

const Api = moduleApi<{
  whoAmI(input: { actorId: string | null; projectId: string }): {
    actorId: string | null;
    projectId: string;
  };
  /** The minting module's own check, as langy's `verifyLocalControlSessionKey`. */
  verifySessionKey(presented: SessionKeyPresented): Promise<Holder>;
}>()("langy");

/** The minter's door: the framework parsed the key, the module reads its instance header. */
const sessionKeyDoor = defineRestDoor("session_key", {
  needs: Api,
  identify: async ({ sessionKey, request }, langy) => {
    if (sessionKey === null) throw new ProjectMissingCredentialsError();
    const holder = await langy.verifySessionKey({
      ...sessionKey,
      instanceToken: request.headers.get(INSTANCE_HEADER),
    });

    return {
      actor: holder.actor,
      scope: { tier: "project", id: holder.projectId },
      session: holder,
    };
  },
});

function minting(verifySessionKey: (presented: SessionKeyPresented) => Promise<Holder>) {
  return {
    whoAmI: (input: { actorId: string | null; projectId: string }) => input,
    verifySessionKey,
  };
}

const declaration = defineRestRouter(Api)
  .withNamespace("session-key")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("session_key")
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
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  const service = minting(async (key) => {
    presented.push(key);
    const minted = MINTED.get(key.token);
    if (!minted || minted.expiresAt <= NOW || minted.projectId !== key.projectId) {
      throw new ProjectInvalidCredentialsError();
    }

    return { actor: { type: "user", id: minted.userId }, projectId: minted.projectId };
  });
  host.mount(declaration.router(), () => service, {
    middlewareBindings: [bindRestCredential("session_key", () => sessionKeyDoor.open(service))],
  });

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

  describe("given the key as Basic base64(projectId:token)", () => {
    it("reads the project and the key from the header", async () => {
      const presented: SessionKeyPresented[] = [];
      const basic = Buffer.from("project-1:sk-lw-session-live").toString("base64");
      const response = await hostWith(presented).app.request("/api/session-key/me", {
        headers: { authorization: `Basic ${basic}`, "x-project-id": "project-2" },
      });

      expect(response.status).toBe(200);
      expect(presented).toEqual([
        { token: "sk-lw-session-live", projectId: "project-1", instanceToken: null },
      ]);
    });
  });

  describe("given a Basic header that does not decode to projectId:token", () => {
    it("refuses as missing credentials without asking the module", async () => {
      const presented: SessionKeyPresented[] = [];
      const response = await hostWith(presented).app.request("/api/session-key/me", {
        headers: { authorization: `Basic ${Buffer.from("no-separator").toString("base64")}` },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
      expect(presented).toEqual([]);
    });
  });

  describe("given the key only in X-Auth-Token", () => {
    it("refuses as missing credentials, as main's session core did", async () => {
      const presented: SessionKeyPresented[] = [];
      const response = await hostWith(presented).app.request("/api/session-key/me", {
        headers: { "x-auth-token": "sk-lw-session-live", "x-project-id": "project-1" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
      expect(presented).toEqual([]);
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
    /** @scenario "A route naming a credential nobody bound refuses the boot" */
    it("refuses the mount, naming the credential", () => {
      const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
      const host = RestHost.create({
        authz: authorizationPort.forRequest(),
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
      });
      expect(() =>
        host.mount(declaration.router(), () => ({
          whoAmI: (input: { actorId: string | null; projectId: string }) => input,
        })),
      ).toThrow(/"session_key", which nothing binds/);
    });
  });
});

describe("a route that declares the session key door's session", () => {
  const sessionSchema = z.object({ projectId: z.string(), conversationId: z.string() });
  const sessionRoutes = defineRestRouter(Api)
    .withNamespace("session-key-session")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })
    .withCredential("session_key")
    .get("/api/session-key/session", "sessionKeySession")
    .withCredential("session_key", { session: sessionSchema })
    .withAccess(anyAuthenticated({ reason: "the session key door fixture" }))
    .withOutput(z.object({ session: sessionSchema }))
    .handle(({ session }) => ({ session }))
    .build();

  /** @scenario "The session key door hands its holder as the route's session" */
  it("hands the handler what the minting module said of the key, parsed by its schema", async () => {
    const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
    const host = RestHost.create({
      authz: authorizationPort.forRequest(),
      identities: {
        project: closed,
        organization: closed,
        api_key: closed,
        instance_admin: closed,
        browser: closed,
      },
      bearers: () => closed,
      audit: { record: async () => {} },
    });
    const service = minting(async () => ({
      actor: { type: "user", id: "user-1" },
      projectId: "project-1",
      conversationId: "conversation-1",
    }));
    host.mount(sessionRoutes.router(), () => service, {
      middlewareBindings: [bindRestCredential("session_key", () => sessionKeyDoor.open(service))],
    });

    const response = await host.app.request("/api/session-key/session", {
      headers: { authorization: "Bearer sk-lw-session-live", "x-project-id": "project-1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      session: { projectId: "project-1", conversationId: "conversation-1" },
    });
  });
});
