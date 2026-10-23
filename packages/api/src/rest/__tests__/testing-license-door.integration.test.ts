/**
 * The testing-licence token door (ADR-180 section 2): every token, personal or service, acts as
 * the person who made it, asked the route's platform permission on every call.
 * Spec: packages/api/specs/transport-declaration-split.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { defineRestDoor } from "../door.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

class TokenRefusedError extends HandledError {
  constructor() {
    super("testing_license_token_invalid", "the testing license token is not valid", {
      httpStatus: 401,
    });
  }
}

const issuerSchema = z.object({ tokenId: z.string(), kind: z.enum(["personal", "service"]) });

const Api = moduleApi<{
  issue(input: { tokenId: string; actorId: string | null }): {
    tokenId: string;
    actorId: string | null;
  };
  /** What the door asks the owning module: which token the bearer is, or its refusal. */
  verify(input: { bearer: string | null }): Promise<{
    tokenId: string;
    kind: "personal" | "service";
    userId: string | null;
  }>;
}>()("licensing");

const issueRoutes = defineRestRouter(Api)
  .withNamespace("testing-door")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("testing_license_token")
  .post("/api/testing-door/issue", "testingDoorIssue")
  .keepsRecords()
  .withCredential("testing_license_token", { session: issuerSchema })
  .withInput(z.object({ count: z.number() }))
  .withPermission("ops:manage", { at: "platform" })
  .withOutput(z.object({ tokenId: z.string(), actorId: z.string().nullable() }))
  .withoutAudit("test route")
  .handle(({ app, actor, session }) =>
    app.issue({ tokenId: session.tokenId, actorId: actor?.type === "user" ? actor.id : null }),
  )
  .build();

const undeclaredRoutes = defineRestRouter(Api)
  .withNamespace("testing-door-open")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("testing_license_token")
  .post("/api/testing-door-open/issue", "testingDoorOpenIssue")
  .keepsRecords()
  .withInput(z.object({ count: z.number() }))
  .withAccess(anyAuthenticated({ reason: "a route that forgot the platform permission" }))
  .withOutput(z.object({ tokenId: z.string(), actorId: z.string().nullable() }))
  .withoutAudit("test route")
  .handle(({ app }) => app.issue({ tokenId: "none", actorId: null }))
  .build();

const testingDoor = defineRestDoor("testing_license_token", {
  needs: Api,
  identify: async ({ bearer }, service) => {
    const token = await service.verify({ bearer });
    return {
      scope: null,
      actor: token.userId === null ? null : { type: "user", id: token.userId },
      session: { tokenId: token.tokenId, kind: token.kind },
    };
  },
});

const TOKENS = {
  lwtl_personal: { tokenId: "token-personal", kind: "personal", userId: "user-ops" },
  lwtl_service: { tokenId: "token-service", kind: "service", userId: "user-maker" },
  lwtl_userless: { tokenId: "token-userless", kind: "service", userId: null },
} as const;

function harness({ operators }: { operators: Set<string> }) {
  const asked: string[] = [];
  const handled: string[] = [];
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const server = RestHost.create({
    authz: {
      ...authorizationPort.forRequest(),
      getPlatformDecision: async ({ userId }) => {
        asked.push(userId);
        return { permitted: operators.has(userId) };
      },
    },
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
  const service = {
    issue: (input: { tokenId: string; actorId: string | null }) => {
      handled.push(input.tokenId);
      return input;
    },
    verify: async ({ bearer }: { bearer: string | null }) => {
      const token =
        bearer === "lwtl_personal" || bearer === "lwtl_service" || bearer === "lwtl_userless"
          ? TOKENS[bearer]
          : null;
      if (!token) throw new TokenRefusedError();
      return token;
    },
  };
  const bindings = [bindRestCredential("testing_license_token", () => testingDoor.open(service))];
  server.mount(issueRoutes.router(), () => service, { middlewareBindings: bindings });

  const post = (bearer: string, body = '{"count":1}') =>
    server.app.request("/api/testing-door/issue", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body,
    });

  return { server, service, bindings, asked, handled, post };
}

describe("the testing license token door", () => {
  describe("given a personal token whose person holds the platform permission", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("asks that person on this call and runs the handler as them", async () => {
      const { post, asked } = harness({ operators: new Set(["user-ops"]) });

      const response = await post("lwtl_personal");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tokenId: "token-personal", actorId: "user-ops" });
      expect(asked).toEqual(["user-ops"]);
    });
  });

  describe("given the person no longer holds it", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("refuses the next call before the body is read, and the handler never runs", async () => {
      const operators = new Set(["user-ops"]);
      const { post, handled } = harness({ operators });
      await post("lwtl_personal");
      operators.delete("user-ops");

      const response = await post("lwtl_personal", '{"count":"many"}');

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "permission_denied" });
      expect(handled).toEqual(["token-personal"]);
    });
  });

  describe("given a service token whose maker holds the platform permission", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("asks the person who made it, the same as a personal token, and runs as them", async () => {
      const { post, asked } = harness({ operators: new Set(["user-maker"]) });

      const response = await post("lwtl_service");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        tokenId: "token-service",
        actorId: "user-maker",
      });
      expect(asked).toEqual(["user-maker"]);
    });
  });

  describe("given a service token whose maker no longer holds the platform permission", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("refuses its token, and the handler never runs", async () => {
      const { post, handled } = harness({ operators: new Set() });

      const response = await post("lwtl_service");

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "permission_denied" });
      expect(handled).toEqual([]);
    });
  });

  describe("given a token the door verified but handed no user for", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("refuses it without asking anyone, and the handler never runs", async () => {
      const { post, asked, handled } = harness({ operators: new Set(["user-maker"]) });

      const response = await post("lwtl_userless");

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "permission_denied" });
      expect(asked).toEqual([]);
      expect(handled).toEqual([]);
    });
  });

  describe("given a bearer the module refuses", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("answers the module's refusal and runs nothing", async () => {
      const { post, handled } = harness({ operators: new Set(["user-ops"]) });

      const response = await post("lwtl_unknown");

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "testing_license_token_invalid" });
      expect(handled).toEqual([]);
    });
  });

  describe("given a route behind the door that declares no platform permission", () => {
    /** @scenario "The testing licence token door asks the token's user for the platform grant on every call" */
    it("refuses the mount, naming the route", () => {
      const { server, service, bindings } = harness({ operators: new Set() });

      expect(() =>
        server.mount(undeclaredRoutes.router(), () => service, { middlewareBindings: bindings }),
      ).toThrow(/testing-door-open\/issue.*testing_license_token/);
    });
  });
});
