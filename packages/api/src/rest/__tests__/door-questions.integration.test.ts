/**
 * What a door is asked before the body: a platform-tier permission (E4), the key it resolved
 * (E5), the key kinds a route admits (E7) and a permission behind the CLI token door (E8).
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
import type {
  AuthzPermission,
  PlatformTierPermission,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  KeyKindRefusedError,
  OrganizationInvalidCredentialsError,
  createErrorHandler,
} from "../../errors.ts";
import type { RestCaller, RestIdentity } from "../../hosting/api-door.ts";
import { SessionReader, type SessionCaller } from "../../hosting/session-reader.ts";
import { BrowserSessionIdentity } from "../browser-session.ts";
import { CliTokenIdentity } from "../cli-token-identity.ts";
import { recordOrganizationCredential, recordProjectCredential } from "../credential.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-10-05";
const SAME_SITE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

interface DoorsApi {
  run(input: unknown): Promise<unknown>;
  plain(input: unknown): Promise<unknown>;
  sources(input: unknown): Promise<unknown>;
}

const DoorsApi = moduleApi<DoorsApi>()("ops");
const doorsApp = { run: async () => ({}), plain: async () => ({}), sources: async () => ({}) };

function mount(
  router: Parameters<ReturnType<typeof createRestRuntime>["mount"]>[0],
  identity: RestIdentity,
) {
  return createRestRuntime({ identity }).mount(router, {
    app: () => doorsApp,
    onError: createErrorHandler(),
  });
}

async function bodyOf(response: Response): Promise<{ code?: string; meta?: unknown }> {
  return (await response.json()) as { code?: string; meta?: unknown };
}

describe("a platform route", () => {
  /** Sessions by cookie value; `holders` hold the platform grant. */
  function browserDoor({ holders }: { holders: readonly string[] }) {
    const asked: { userId: string; permission: PlatformTierPermission }[] = [];
    const sessions: Record<string, SessionCaller> = {
      operator: { userId: "operator-1" },
      member: { userId: "member-1" },
      impersonated: { userId: "member-1", impersonator: { id: "operator-1" } },
    };
    const door = BrowserSessionIdentity.create({
      sessions: SessionReader.create({
        verify: async (request: Request) => sessions[request.headers.get("cookie") ?? ""] ?? null,
      }),
      authz: {
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getPlatformDecision: async (input) => {
          asked.push(input);

          return { permitted: holders.includes(input.userId) };
        },
      },
      publicBaseUrl: void 0,
    });

    return { asked, door };
  }

  function declaration({ refusal, ran }: { refusal: "denied" | "hidden"; ran: string[] }) {
    return defineRestRouter(DoorsApi)
      .withNamespace(`e4-${refusal}`)
      .withVersion(VERSION)
      .withCredential("browser")
      .post("/impersonate", "run")
      .withPermission("ops:manage", { at: "platform", refusal })
      .withInput(z.object({ userId: z.string() }))
      .withBodyLimit({ maxBytes: 64 })
      .withOutput(z.object({ actor: z.string() }))
      .handle(({ actor }) => {
        ran.push(actor.id);

        return { actor: actor.id };
      })
      .build()
      .router();
  }

  function call(
    app: ReturnType<typeof mount>,
    refusal: string,
    cookie: string | null,
    body: string,
  ) {
    return app.request(`/api/e4-${refusal}/${VERSION}/impersonate`, {
      method: "POST",
      headers: cookie ? { ...SAME_SITE, cookie } : SAME_SITE,
      body,
    });
  }

  describe("when the caller holds the permission at the platform", () => {
    /** @scenario "A platform route asks the operator's platform grant at its door" */
    it("asks the platform question of the caller and runs the handler", async () => {
      const ran: string[] = [];
      const { asked, door } = browserDoor({ holders: ["operator-1"] });
      const app = mount(declaration({ refusal: "denied", ran }), door);

      const response = await call(app, "denied", "operator", JSON.stringify({ userId: "u-2" }));

      expect(response.status).toBe(200);
      expect(asked).toEqual([{ userId: "operator-1", permission: "ops:manage" }]);
      expect(ran).toEqual(["operator-1"]);
    });
  });

  describe("when an operator acts as another user", () => {
    /** @scenario "A platform route asks the operator's platform grant at its door" */
    it("asks about the grant of the operator behind them", async () => {
      const ran: string[] = [];
      const { asked, door } = browserDoor({ holders: ["operator-1"] });
      const app = mount(declaration({ refusal: "denied", ran }), door);

      const response = await call(app, "denied", "impersonated", JSON.stringify({ userId: "u" }));

      expect(response.status).toBe(200);
      expect(asked).toEqual([{ userId: "operator-1", permission: "ops:manage" }]);
      expect(ran).toEqual(["member-1"]);
    });
  });

  describe("when the caller lacks the permission or has no session", () => {
    /** @scenario "A platform route asks the operator's platform grant at its door" */
    it("refuses 403 permission_denied, and 401 with no session, before the body is read", async () => {
      const ran: string[] = [];
      const { door } = browserDoor({ holders: ["operator-1"] });
      const app = mount(declaration({ refusal: "denied", ran }), door);

      const lacking = await call(app, "denied", "member", "{not json");
      const anonymous = await call(app, "denied", null, "{not json");

      expect(lacking.status).toBe(403);
      expect(await bodyOf(lacking)).toMatchObject({
        code: "permission_denied",
        meta: { permission: "ops:manage" },
      });
      expect(anonymous.status).toBe(401);
      expect(ran).toEqual([]);
    });
  });

  describe("when the route declares its refusal hidden", () => {
    /** @scenario "A hidden platform route answers not found to everyone it refuses" */
    it("answers 404 not_found to a caller lacking it and to one with no session, before the cap", async () => {
      const ran: string[] = [];
      const { door } = browserDoor({ holders: ["operator-1"] });
      const app = mount(declaration({ refusal: "hidden", ran }), door);
      const oversized = JSON.stringify({ userId: "u".repeat(200) });

      const lacking = await call(app, "hidden", "member", oversized);
      const anonymous = await call(app, "hidden", null, oversized);
      const holder = await call(app, "hidden", "operator", oversized);

      expect([lacking.status, anonymous.status]).toEqual([404, 404]);
      expect((await bodyOf(lacking)).code).toBe("not_found");
      expect((await bodyOf(anonymous)).code).toBe("not_found");
      expect(holder.status).toBe(413);
      expect(ran).toEqual([]);
    });
  });

  describe("when the declaration asks the wrong permission at the platform", () => {
    function route() {
      return defineRestRouter(DoorsApi)
        .withNamespace("e4-declared")
        .withVersion(VERSION)
        .withCredential("browser")
        .post("/run", "run");
    }

    /** @scenario "A platform route asks the operator's platform grant at its door" */
    it("refuses a non-platform permission at the platform, and a platform one anywhere else", () => {
      expect(() => route().withPermission("traces:view" as never, { at: "platform" })).toThrow(
        /only a platform-tier permission/,
      );
      expect(() => route().withPermission("ops:view")).toThrow(/declare \{ at: "platform" \}/);
    });

    /** @scenario "A platform route asks the operator's platform grant at its door" */
    it("refuses a mount whose door cannot answer the platform question, naming the route", () => {
      const router = defineRestRouter(DoorsApi)
        .withNamespace("e4-unanswered")
        .withVersion(VERSION)
        .withCredential("browser")
        .post("/run", "run")
        .withPermission("ops:view", { at: "platform" })
        .withOutput(z.object({}))
        .handle(() => ({}))
        .build()
        .router();
      const identifies: RestIdentity = {
        authenticate: () => ({ actor: null, scope: null }),
        identify: () => ({ actor: { type: "user", id: "u" }, scope: null }),
      };

      expect(() => mount(router, identifies)).toThrow(
        /POST .*e4-unanswered.*\/run.*authorizePlatform/,
      );
    });
  });
});

const PROJECT = { id: "project-1", slug: "p", teamId: "team-1" } as never;

/** The credential each presented key stands for, as the project door records it. */
const PROJECT_KEYS: Record<string, RestResolvedProjectCredential> = {
  personal: {
    type: "apiKey",
    apiKeyId: "key-1",
    userId: "user-1",
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  },
  ownerless: {
    type: "apiKey",
    apiKeyId: "key-2",
    userId: null,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  },
  ingestion: {
    type: "apiKey",
    apiKeyId: "key-3",
    userId: "user-1",
    organizationId: "org-1",
    ingestSourceType: "otel",
    ingestionTemplateId: "template-1",
    project: PROJECT,
  },
  langy: {
    type: "apiKey",
    apiKeyId: "key-4",
    userId: "user-1",
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    isLangySessionKey: true,
    project: PROJECT,
  },
  token: { type: "cliAccessToken", userId: "user-1", organizationId: "org-1", project: PROJECT },
  legacy: { type: "legacyProjectKey", project: PROJECT },
};

const PROJECT_CALLER: RestCaller = {
  actor: { type: "api_key", id: "key" },
  scope: { tier: "project", id: "project-1" },
};

/** A project door that records the key it resolved; `honoursKinds` refuses outside the list. */
function projectDoor({ honoursKinds }: { honoursKinds: boolean }) {
  const told: (readonly string[] | undefined)[] = [];
  const door: RestIdentity = {
    authenticate: ({ request, keyKinds }) => {
      told.push(keyKinds);
      const resolved = PROJECT_KEYS[request.headers.get("x-auth-token") ?? ""];
      if (!resolved) throw new OrganizationInvalidCredentialsError();
      recordProjectCredential(request, resolved);
      const kind =
        resolved.type === "apiKey" && resolved.ingestionTemplateId ? "ingestion_key" : null;
      if (honoursKinds && keyKinds && kind && !keyKinds.includes(kind)) {
        throw new KeyKindRefusedError(kind);
      }

      return PROJECT_CALLER;
    },
  };

  return { told, door };
}

describe("a route that reads the key its door resolved", () => {
  const router = defineRestRouter(DoorsApi)
    .withNamespace("e5-keys")
    .withVersion(VERSION)
    .post("/read", "run")
    .withCredential("project", { key: true })
    .withPermission("traces:create")
    .withOutput(z.object({ key: z.unknown() }))
    .handle(({ key }) => ({ key }))
    .post("/plain", "plain")
    .withPermission("traces:create")
    .withOutput(z.object({ handed: z.boolean() }))
    .handle((args) => ({ handed: (args as { key?: unknown }).key !== undefined }))
    .build()
    .router();

  async function keyFor(token: string): Promise<unknown> {
    const { door } = projectDoor({ honoursKinds: false });
    const response = await mount(router, door).request(`/api/e5-keys/${VERSION}/read`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": token },
      body: "{}",
    });

    return ((await response.json()) as { key: unknown }).key;
  }

  /** @scenario "A route hands its handler the key the door resolved" */
  it("hands the kind, the key id and the owner of each kind of key", async () => {
    expect(await keyFor("personal")).toEqual({
      kind: "api_key",
      apiKeyId: "key-1",
      ownerUserId: "user-1",
    });
    expect(await keyFor("ownerless")).toEqual({
      kind: "api_key",
      apiKeyId: "key-2",
      ownerUserId: null,
    });
    expect(await keyFor("token")).toEqual({
      kind: "access_token",
      apiKeyId: null,
      ownerUserId: "user-1",
    });
    expect(await keyFor("legacy")).toEqual({
      kind: "legacy_project_key",
      apiKeyId: null,
      ownerUserId: null,
    });
    expect(await keyFor("ingestion")).toMatchObject({ kind: "ingestion_key" });
    expect(await keyFor("langy")).toMatchObject({ kind: "langy_session_key" });
  });

  /** @scenario "A route hands its handler the key the door resolved" */
  it("hands an organization key as an API key", async () => {
    const door: RestIdentity = {
      authenticate: ({ request }) => {
        recordOrganizationCredential(request, {
          type: "apiKey-org",
          apiKeyId: "org-key",
          userId: null,
          organizationId: "org-1",
        });

        return {
          actor: { type: "api_key", id: "org-key" },
          scope: { tier: "organization", id: "org-1" },
        };
      },
    };
    const organizationRouter = defineRestRouter(DoorsApi)
      .withNamespace("e5-org")
      .withVersion(VERSION)
      .withCredential("organization")
      .get("/read", "run")
      .withCredential("organization", { key: true })
      .withPermission("organization:view")
      .withOutput(z.object({ key: z.unknown() }))
      .handle(({ key }) => ({ key }))
      .build()
      .router();

    const response = await mount(organizationRouter, door).request(`/api/e5-org/${VERSION}/read`);

    expect(await response.json()).toEqual({
      key: { kind: "api_key", apiKeyId: "org-key", ownerUserId: null },
    });
  });

  /** @scenario "A route hands its handler the key the door resolved" */
  it("hands no key to a route that did not declare it", async () => {
    const { door } = projectDoor({ honoursKinds: false });

    const response = await mount(router, door).request(`/api/e5-keys/${VERSION}/plain`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": "personal" },
      body: "{}",
    });

    expect(await response.json()).toEqual({ handed: false });
  });

  /** @scenario "A route hands its handler the key the door resolved" */
  it("refuses the declaration behind a door that resolves no key", () => {
    const route = defineRestRouter(DoorsApi)
      .withNamespace("e5-no")
      .withVersion(VERSION)
      .get("/x", "run");

    expect(() => route.withCredential("browser", { key: true } as never)).toThrow(
      /"browser" door, which resolves none/,
    );
  });
});

describe("a route that admits only the key kinds it names", () => {
  const router = defineRestRouter(DoorsApi)
    .withNamespace("e7-kinds")
    .withVersion(VERSION)
    .post("/connect", "run")
    .withCredential("project", { keyKinds: ["api_key", "access_token", "legacy_project_key"] })
    .withPermission("scenarios:manage")
    .withInput(z.object({ name: z.string() }))
    .withOutput(z.object({ ran: z.boolean() }))
    .handle(() => ({ ran: true }))
    .build()
    .router();

  function connect(app: ReturnType<typeof mount>, token: string, body: string) {
    return app.request(`/api/e7-kinds/${VERSION}/connect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": token },
      body,
    });
  }

  describe("when the door honours the list", () => {
    /** @scenario "A route admits only the key kinds it names" */
    it("tells the door the admitted kinds and refuses another kind before the body", async () => {
      const { door, told } = projectDoor({ honoursKinds: true });
      const app = mount(router, door);

      const refused = await connect(app, "ingestion", "{not json");
      const admitted = await connect(app, "personal", JSON.stringify({ name: "a" }));

      expect(refused.status).toBe(403);
      expect(await bodyOf(refused)).toMatchObject({
        code: "key_type_not_allowed",
        meta: { kind: "ingestion_key" },
      });
      expect(admitted.status).toBe(200);
      expect(told[0]).toEqual(["api_key", "access_token", "legacy_project_key"]);
    });
  });

  describe("when the door ignores the list", () => {
    /** @scenario "A route admits only the key kinds it names" */
    it("refuses the key after the door, before the body", async () => {
      const { door } = projectDoor({ honoursKinds: false });
      const app = mount(router, door);

      const ingestion = await connect(app, "ingestion", "{not json");
      const langy = await connect(app, "langy", "{not json");

      expect([ingestion.status, langy.status]).toEqual([403, 403]);
      expect(await bodyOf(langy)).toMatchObject({
        code: "key_type_not_allowed",
        meta: { kind: "langy_session_key" },
      });
    });
  });

  /** @scenario "A route admits only the key kinds it names" */
  it("refuses an empty or repeating list, and a list behind any door but the project door", () => {
    const route = () =>
      defineRestRouter(DoorsApi).withNamespace("e7-declared").withVersion(VERSION).get("/x", "run");

    expect(() => route().withCredential("project", { keyKinds: [] as never })).toThrow(
      /admits no key kind/,
    );
    expect(() => route().withCredential("project", { keyKinds: ["api_key", "api_key"] })).toThrow(
      /names one key kind twice/,
    );
    expect(() =>
      route().withCredential("organization", { keyKinds: ["api_key"] } as never),
    ).toThrow(/only the project door tells them apart/);
  });
});

describe("a permission behind the CLI token door", () => {
  type Asked = { userId: string; permission: AuthzPermission; scope: unknown };

  function cliDoor({ refuses = [] }: { refuses?: readonly AuthzPermission[] } = {}) {
    const asked: Asked[] = [];
    const door = CliTokenIdentity.create({
      verify: async ({ authorization }) => {
        if (authorization !== "Bearer lw_at_live") throw new OrganizationInvalidCredentialsError();

        return { userId: "user-1", organizationId: "org-1" };
      },
      permitted: (input) => {
        asked.push(input);

        return { permitted: !refuses.includes(input.permission), organizationRole: "MEMBER" };
      },
    });

    return { asked, door };
  }

  function declaration(ran: string[]) {
    return defineRestRouter(DoorsApi)
      .withNamespace("e8-cli")
      .withVersion(VERSION)
      .withCredential("cli_token")
      .post("/keys", "run")
      .withPermission("organization:manage")
      .withInput(z.object({ name: z.string() }))
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(() => {
        ran.push("keys");

        return { ran: true };
      })
      .get("/sources", "sources")
      .withPermission("organization:view", { at: "organization" })
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(() => {
        ran.push("sources");

        return { ran: true };
      })
      .build()
      .router();
  }

  const BEARER = { "content-type": "application/json", authorization: "Bearer lw_at_live" };

  /** @scenario "A permission behind the CLI token door is asked of the token's person at its organization" */
  it("asks the token's person at the token's organization, then runs the handler", async () => {
    const ran: string[] = [];
    const { asked, door } = cliDoor();
    const app = mount(declaration(ran), door);

    const minted = await app.request(`/api/e8-cli/${VERSION}/keys`, {
      method: "POST",
      headers: BEARER,
      body: JSON.stringify({ name: "laptop" }),
    });
    const listed = await app.request(`/api/e8-cli/${VERSION}/sources`, { headers: BEARER });

    expect([minted.status, listed.status]).toEqual([200, 200]);
    expect(asked).toEqual([
      {
        userId: "user-1",
        permission: "organization:manage",
        scope: { tier: "organization", id: "org-1" },
      },
      {
        userId: "user-1",
        permission: "organization:view",
        scope: { tier: "organization", id: "org-1" },
      },
    ]);
    expect(ran).toEqual(["keys", "sources"]);
  });

  /** @scenario "A permission behind the CLI token door is asked of the token's person at its organization" */
  it("refuses a person lacking it 403 permission_denied before the body", async () => {
    const ran: string[] = [];
    const { door } = cliDoor({ refuses: ["organization:manage"] });

    const response = await mount(declaration(ran), door).request(`/api/e8-cli/${VERSION}/keys`, {
      method: "POST",
      headers: BEARER,
      body: "{not json",
    });

    expect(response.status).toBe(403);
    expect((await bodyOf(response)).code).toBe("permission_denied");
    expect(ran).toEqual([]);
  });

  /** @scenario "A permission behind the CLI token door is asked of the token's person at its organization" */
  it("refuses the mount behind a door built with no way to ask, naming the route", () => {
    const door = CliTokenIdentity.create({
      verify: async () => ({ userId: "user-1", organizationId: "org-1" }),
    });

    expect(() => mount(declaration([]), door)).toThrow(/POST .*e8-cli.*\/keys.*CLI token door/);
  });
});
