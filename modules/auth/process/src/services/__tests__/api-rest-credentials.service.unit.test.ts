/**
 * The key door (#8085): any API key authenticates without naming a project, and resolves to the
 * principal the query door fans out from. Only a missing or unusable token is refused.
 */
import type {
  ApiKeyApi,
  ApiKeyProject,
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import { AggregateProjectHasNoCredentialError } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import {
  ApiRestCredentialsService,
  type ApiRestCredentialPeers,
} from "../api-rest-credentials.service.ts";

const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
};

/** An in-memory key store: tokens it knows resolve, everything else is unusable. */
class KeyStore implements Pick<
  ApiKeyApi,
  "findResolvedToken" | "resolveOrganizationToken" | "markUsed" | "getOrgProjects"
> {
  readonly used: string[] = [];

  constructor(
    private readonly projectTokens: ReadonlyMap<string, ResolvedApiKeyCredential>,
    private readonly organizationTokens: ReadonlyMap<string, OrganizationApiKeyResolution>,
    /** An organization's projects, and what a token resolves to when it names one (`token@id`). */
    private readonly organizations: Readonly<{
      projects: ReadonlyMap<string, ApiKeyProject[]>;
      named: ReadonlyMap<string, ResolvedApiKeyCredential>;
    }> = { projects: new Map(), named: new Map() },
  ) {}

  findResolvedToken({
    token,
    projectId,
  }: ApiKeyTokenResolutionInput): Promise<ResolvedApiKeyCredential | null> {
    const named = projectId ? this.organizations.named.get(`${token}@${projectId}`) : undefined;
    return Promise.resolve(named ?? this.projectTokens.get(token) ?? null);
  }

  getOrgProjects({ organizationId }: { organizationId: string }): Promise<ApiKeyProject[]> {
    return Promise.resolve(this.organizations.projects.get(organizationId) ?? []);
  }

  resolveOrganizationToken({ token }: { token: string }): Promise<OrganizationApiKeyResolution> {
    return Promise.resolve(
      this.organizationTokens.get(token) ?? { ok: false, reason: "unusable_credential" },
    );
  }

  markUsed({ id }: { id: string }): void {
    this.used.push(id);
  }
}

function doorOver(store: KeyStore): ApiRestCredentialsService {
  const peers: ApiRestCredentialPeers = {
    apiKeys: store,
    authz: {
      hasApiKeyPermission: () => Promise.reject(new Error("the key door asks no permission")),
      getApiKeyProjectDecision: () => Promise.reject(new Error("the key door asks no permission")),
      hasProjectPermission: () => Promise.reject(new Error("the key door asks no permission")),
      listApiKeyBindings: () => Promise.reject(new Error("the key door asks no permission")),
      getScope: () => Promise.reject(new Error("the key door reads no scope")),
    },
    cliProjects: {
      getCliAccessProject: () => Promise.reject(new Error("the key door reads no CLI session")),
    },
    organizations: {
      getSettings: () => Promise.reject(new Error("the key door reads no organization")),
    },
  };

  return ApiRestCredentialsService.create(peers);
}

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/query", { method: "POST", headers });
}

const store = new KeyStore(
  new Map<string, ResolvedApiKeyCredential>([
    ["legacy-key", { type: "legacyProjectKey", project: PROJECT }],
    [
      "sk-lw-project",
      {
        type: "apiKey",
        apiKeyId: "key-project",
        userId: "user-1",
        organizationId: "org-1",
        ingestSourceType: null,
        ingestionTemplateId: null,
        project: PROJECT,
      },
    ],
  ]),
  new Map<string, OrganizationApiKeyResolution>([
    ["sk-lw-project", { ok: false, reason: "wrong_credential_class" }],
    [
      "sk-lw-org",
      {
        ok: true,
        resolved: {
          type: "apiKey-org",
          apiKeyId: "key-org",
          userId: null,
          organizationId: "org-2",
        },
      },
    ],
  ]),
);
const door = doorOver(store);
const ORG_KEY: OrganizationApiKeyResolution = {
  ok: true,
  resolved: { type: "apiKey-org", apiKeyId: "key-org", userId: null, organizationId: "org-2" },
};

async function refusalCode(attempt: Promise<unknown>): Promise<string> {
  const error = await attempt.then(
    () => new Error("the door admitted the request"),
    (refusal: unknown) => refusal,
  );
  if (!HandledError.isHandled(error)) throw error;
  return error.code;
}

describe("the key door", () => {
  describe("given a legacy project key", () => {
    /** @scenario "A legacy prefix-less project key with no session still authenticates" */
    /** @scenario "API key authentication via X-Auth-Token header" */
    it("resolves the key to exactly its own project, in that project's organization", async () => {
      const credential = await door.identifyKey({
        request: request({ "x-auth-token": "legacy-key" }),
      });

      expect(credential.principal).toEqual({ kind: "project", projectId: "project-1" });
      expect(credential.organizationId).toBe("org-1");
      credential.markUsed();
      expect(store.used).not.toContain("legacy-key");
    });
  });

  describe("given a legacy project key in the Authorization Bearer header", () => {
    /** @scenario "API key authentication via Authorization Bearer header" */
    it("resolves the key to exactly its own project", async () => {
      const credential = await door.identifyKey({
        request: request({ authorization: "Bearer legacy-key" }),
      });

      expect(credential.principal).toEqual({ kind: "project", projectId: "project-1" });
      expect(credential.organizationId).toBe("org-1");
    });
  });

  describe("given an empty or whitespace-only Bearer token beside an X-Auth-Token", () => {
    /** @scenario Empty or whitespace-only Bearer token does not poison X-Auth-Token fallback */
    it.each(["Bearer ", "Bearer    ", "Bearer"])(
      "falls through to the X-Auth-Token credential when Authorization is %j",
      async (authorization) => {
        const credential = await door.identifyKey({
          request: request({ authorization, "x-auth-token": "legacy-key" }),
        });

        expect(credential.principal).toEqual({ kind: "project", projectId: "project-1" });
      },
    );
  });

  describe("given an Authorization: Basic header beside an X-Auth-Token", () => {
    /** @scenario Authorization header from a proxy does not poison X-Auth-Token fallback */
    it("uses the X-Auth-Token, which wins over Basic", async () => {
      const credential = await door.identifyKey({
        request: request({
          authorization: `Basic ${btoa("proxy-user:proxy-password")}`,
          "x-auth-token": "legacy-key",
        }),
      });

      expect(credential.principal).toEqual({ kind: "project", projectId: "project-1" });
    });

    /** @scenario Authorization Basic is read when no X-Auth-Token is sent */
    it("reads the Basic credential when no X-Auth-Token is sent", async () => {
      const credential = await door.identifyKey({
        request: request({ authorization: `Basic ${btoa("project-1:legacy-key")}` }),
      });

      expect(credential.principal).toEqual({ kind: "project", projectId: "project-1" });
    });
  });

  describe("given an API key that resolves a project", () => {
    it("still reaches its organization, naming the project it resolved", async () => {
      const credential = await door.identifyKey({
        request: request({ authorization: "Bearer sk-lw-project", "x-project-id": "project-1" }),
      });

      expect(credential.principal).toEqual({
        kind: "apiKey",
        apiKeyId: "key-project",
        userId: "user-1",
        organizationId: "org-1",
        resolvedProject: { id: "project-1", teamId: "team-1" },
      });
      credential.markUsed();
      expect(store.used).toContain("key-project");
    });
  });

  describe("given an organization key sent with no project header", () => {
    it("authenticates through its organization rather than refusing it", async () => {
      const credential = await door.identifyKey({
        request: request({ authorization: "Bearer sk-lw-org" }),
      });

      expect(credential.principal).toEqual({
        kind: "apiKey",
        apiKeyId: "key-org",
        userId: null,
        organizationId: "org-2",
      });
      expect(credential.organizationId).toBe("org-2");
      credential.markUsed();
      expect(store.used).toContain("key-org");
    });
  });

  describe("given a request with no credential", () => {
    /** @scenario "A request with neither credential is refused" */
    it("is refused as missing credentials", async () => {
      expect(await refusalCode(door.identifyKey({ request: request({}) }))).toBe(
        "missing_credentials",
      );
    });
  });

  describe("given a token that resolves to neither a project nor an organization", () => {
    /** @scenario "An invalid API key is refused without falling back to the session" */
    it("is refused as invalid credentials", async () => {
      expect(
        await refusalCode(
          door.identifyKey({ request: request({ authorization: "Bearer sk-lw-unknown" }) }),
        ),
      ).toBe("invalid_credentials");
    });
  });
});

/** @see specs/security/api-endpoint-authorization.feature */
describe("the organization door", () => {
  describe("given a token that matches no key at all", () => {
    /** @scenario "A credential that resolves to nothing is not blamed on its class" */
    it("is refused as invalid credentials, naming no credential class", async () => {
      const refusal = await door
        .identifyOrganization({ request: request({ authorization: "Bearer sk-lw-typo" }) })
        .then(
          () => new Error("the door admitted the request"),
          (error: unknown) => error,
        );

      expect(refusal).toMatchObject({ code: "invalid_credentials", httpStatus: 401 });
      expect((refusal as Error).message).not.toMatch(/project|organization/i);
    });

    /** @scenario "A project key on an organization endpoint is told exactly that" */
    it("tells a project key from it, naming the class the endpoint needs and the one presented", async () => {
      const refusal = await door
        .identifyOrganization({ request: request({ authorization: "Bearer sk-lw-project" }) })
        .then(
          () => new Error("the door admitted the request"),
          (error: unknown) => error,
        );

      expect(refusal).toMatchObject({ code: "credential_class_mismatch", httpStatus: 401 });
      expect((refusal as Error).message).toMatch(/requires an organization API key/);
      expect((refusal as Error).message).toMatch(/a project key was presented/);
    });
  });
});

describe("the project door", () => {
  describe("given a live key that reaches several projects and names none", () => {
    /** @scenario "A key that reaches several projects and names none is told to name one" */
    it.each([
      ["with a permission asked", "authenticate"],
      ["with none asked", "identify"],
    ] as const)("is told to name a project, %s", async (_name, method) => {
      const asked = request({ authorization: "Bearer sk-lw-org" });

      expect(
        await refusalCode(door[method]({ request: asked, permissions: ["traces:view"] })),
      ).toBe("project_required");
    });
  });

  describe("given a live key that reaches several projects, holding the route's permission in some", () => {
    const projectOf = (id: string) => ({
      ...PROJECT,
      id,
      name: `Project ${id}`,
      organizationId: "org-2",
    });
    const keyAt = (id: string): ResolvedApiKeyCredential => ({
      type: "apiKey",
      apiKeyId: "key-org",
      userId: null,
      organizationId: "org-2",
      ingestSourceType: null,
      ingestionTemplateId: null,
      project: projectOf(id),
    });
    const reaching = new KeyStore(new Map(), new Map([["sk-lw-org", ORG_KEY]]), {
      projects: new Map([
        [
          "org-2",
          ["project-a", "project-b", "project-c"].map((id) => ({
            id,
            name: `Project ${id}`,
            teamId: "team-1",
          })),
        ],
      ]),
      // The key resolves project-a and project-b; project-c is outside its bindings.
      named: new Map([
        ["sk-lw-org@project-a", keyAt("project-a")],
        ["sk-lw-org@project-b", keyAt("project-b")],
      ]),
    });
    const holdsAt = new Set(["project-a"]);
    const reachingDoor = ApiRestCredentialsService.create({
      apiKeys: reaching,
      authz: {
        hasApiKeyPermission: ({ scope }) => Promise.resolve(holdsAt.has(scope.id)),
        getApiKeyProjectDecision: () => Promise.reject(new Error("asked through the ceiling")),
        hasProjectPermission: () => Promise.reject(new Error("no person is asked")),
        listApiKeyBindings: () => Promise.reject(new Error("no bindings are listed")),
        getScope: () => Promise.reject(new Error("no scope is read")),
      },
      cliProjects: {
        getCliAccessProject: () => Promise.reject(new Error("no CLI session is read")),
      },
      organizations: { getSettings: () => Promise.reject(new Error("no organization is read")) },
    });

    async function refusalOf(attempt: Promise<unknown>): Promise<HandledError> {
      const error = await attempt.then(
        () => new Error("the door admitted the request"),
        (refusal: unknown) => refusal,
      );
      if (!HandledError.isHandled(error)) throw error;
      return error;
    }

    /** @scenario "A key that names no project is told the projects it may name for the route" */
    /** @scenario "Project discovery excludes projects outside the key bindings" */
    it("lists only the projects the key reaches and holds the route's permission in", async () => {
      const refusal = await refusalOf(
        reachingDoor.authenticate({
          request: request({ authorization: "Bearer sk-lw-org" }),
          permissions: ["scenarios:manage"],
        }),
      );

      expect(refusal).toMatchObject({ code: "project_required", httpStatus: 400 });
      expect(refusal.meta).toEqual({ projects: [{ id: "project-a", name: "Project project-a" }] });
    });

    /** @scenario "Project discovery applies the key owner's effective permission" */
    it("lists no project when the key's effective permission holds in none", async () => {
      holdsAt.delete("project-a");
      try {
        const refusal = await refusalOf(
          reachingDoor.authenticate({
            request: request({ authorization: "Bearer sk-lw-org" }),
            permissions: ["scenarios:manage"],
          }),
        );

        expect(refusal).toMatchObject({ code: "project_required", httpStatus: 400 });
        expect(refusal.meta).toEqual({ projects: [] });
      } finally {
        holdsAt.add("project-a");
      }
    });

    /** @scenario "A key asked no permission is told every project it reaches" */
    it("lists every project the key resolves when the route asks nothing of it", async () => {
      const refusal = await refusalOf(
        reachingDoor.identify({ request: request({ authorization: "Bearer sk-lw-org" }) }),
      );

      expect(refusal.meta).toEqual({
        projects: [
          { id: "project-a", name: "Project project-a" },
          { id: "project-b", name: "Project project-b" },
        ],
      });
    });
  });

  describe("given a live key that names a project it does not resolve", () => {
    /** @scenario "A key for one organization cannot resolve another organization's project" */
    it("stays an invalid credential, saying nothing about the project", async () => {
      const asked = request({ authorization: "Bearer sk-lw-org", "x-project-id": "project-9" });

      expect(await refusalCode(door.identify({ request: asked }))).toBe("invalid_credentials");
    });
  });

  describe("given an ingestion key that names no project", () => {
    /** @scenario "Unsupported credentials cannot discover projects" */
    it("resolves as its own project's key and enumerates no organization projects", async () => {
      let listed = 0;
      const ingestion = new (class extends KeyStore {
        override getOrgProjects(input: { organizationId: string }) {
          listed += 1;
          return super.getOrgProjects(input);
        }
      })(
        new Map<string, ResolvedApiKeyCredential>([
          [
            "sk-lw-ingest",
            {
              type: "apiKey",
              apiKeyId: "key-ingest",
              userId: null,
              organizationId: "org-1",
              ingestSourceType: "otel",
              ingestionTemplateId: "template-1",
              project: PROJECT,
            },
          ],
        ]),
        new Map(),
      );

      const credential = await doorOver(ingestion).identify({
        request: request({ authorization: "Bearer sk-lw-ingest" }),
      });

      expect(credential.project.id).toBe("project-1");
      expect(listed).toBe(0);
    });
  });

  describe("given a token no key matches, naming no project", () => {
    /** @scenario "A token that stands for no key is still an invalid credential when it names no project" */
    it("is refused as invalid credentials", async () => {
      const asked = request({ authorization: "Bearer sk-lw-unknown" });

      expect(await refusalCode(door.identify({ request: asked }))).toBe("invalid_credentials");
    });
  });
});

describe("a project-bound CLI access token", () => {
  const asked: { userId: string; projectId: string; permission: string }[] = [];

  function tokenDoor(holds: boolean): ApiRestCredentialsService {
    return ApiRestCredentialsService.create({
      apiKeys: store,
      authz: {
        hasApiKeyPermission: () => Promise.reject(new Error("an access token asks no key grant")),
        getApiKeyProjectDecision: () => Promise.reject(new Error("an access token asks no key")),
        listApiKeyBindings: () => Promise.reject(new Error("an access token lists no grants")),
        getScope: () => Promise.reject(new Error("an access token reads no scope")),
        hasProjectPermission: (input) => {
          asked.push(input);
          return Promise.resolve(holds);
        },
      },
      cliProjects: {
        getCliAccessProject: () =>
          Promise.resolve({ userId: "user-9", organizationId: "org-1", project: PROJECT }),
      },
      organizations: { getSettings: () => Promise.reject(new Error("no organization read")) },
    });
  }

  const bearer = request({ authorization: "Bearer lw_at_session" });

  describe("when the person holds the permission at the bound project", () => {
    it("authenticates as that person on that project, asking their own access", async () => {
      const credential = await tokenDoor(true).authenticate({
        request: bearer,
        permissions: ["traces:view"],
      });

      expect(credential.project.id).toBe("project-1");
      expect(credential.actsAsPerson).toEqual({ userId: "user-9" });
      expect(credential.resolved).toMatchObject({
        type: "cliAccessToken",
        userId: expect.any(String),
      });
      expect(asked).toContainEqual({
        userId: "user-9",
        projectId: "project-1",
        permission: "traces:view",
      });
    });
  });

  describe("when the token arrives as X-Auth-Token, as the MCP tools send it", () => {
    /** @scenario The API door accepts a project-bound access token as the person */
    it("authenticates as that person on the bound project", async () => {
      const credential = await tokenDoor(true).authenticate({
        request: request({ "x-auth-token": "lw_at_session" }),
        permissions: ["traces:view"],
      });

      expect(credential.actsAsPerson).toEqual({ userId: "user-9" });
      expect(credential.project.id).toBe("project-1");
    });
  });

  describe("when it arrives at the key door", () => {
    it("is let in as its person, bound to the one project the token names", async () => {
      const credential = await tokenDoor(true).identifyKey({ request: bearer });

      expect(credential.principal).toEqual({
        kind: "cliAccessToken",
        userId: "user-9",
        organizationId: "org-1",
        projectId: "project-1",
        teamId: "team-1",
      });
      expect(credential.organizationId).toBe("org-1");
    });
  });

  describe("when the person lacks the permission at the bound project", () => {
    it("is refused as a permission denial", async () => {
      expect(
        await refusalCode(
          tokenDoor(false).authenticate({ request: bearer, permissions: ["traces:view"] }),
        ),
      ).toBe("api_key_permission_denied");
    });
  });
});

describe("given a pre-2025 legacy API key, an opaque `eyJ` value never verified as a JWT", () => {
  const PRE_2025_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJwcm9qZWN0SWQiOiJwcm9qZWN0LTEifQ.c2lnbmF0dXJl";
  const legacyStore = new KeyStore(
    new Map<string, ResolvedApiKeyCredential>([
      [PRE_2025_KEY, { type: "legacyProjectKey", project: PROJECT }],
    ]),
    new Map(),
  );
  const headers = [
    ["a bearer", { authorization: `Bearer ${PRE_2025_KEY}` }],
    ["basic auth", { authorization: `Basic ${btoa(`project-1:${PRE_2025_KEY}`)}` }],
    ["X-Auth-Token", { "x-auth-token": PRE_2025_KEY }],
  ] as const;

  for (const [label, sent] of headers) {
    describe(`when it arrives as ${label}`, () => {
      /** @scenario A pre-2025 legacy API key still authenticates on every header */
      it("authenticates as the legacy API key of its project", async () => {
        const credential = await doorOver(legacyStore).identify({ request: request(sent) });

        expect(credential.resolved).toEqual({ type: "legacyProjectKey", project: PROJECT });
      });
    });
  }
});

describe("given a key the directory refuses because its project is an aggregate", () => {
  /** A key store whose resolution refuses one token, as the API-key module does an aggregate's. */
  class AggregateRefusingStore extends KeyStore {
    override findResolvedToken(
      input: ApiKeyTokenResolutionInput,
    ): Promise<ResolvedApiKeyCredential | null> {
      if (input.token === "sk-lw-aggregate") {
        return Promise.reject(new AggregateProjectHasNoCredentialError());
      }
      return super.findResolvedToken(input);
    }
  }
  const aggregateDoor = doorOver(
    new AggregateRefusingStore(new Map(), new Map([["sk-lw-aggregate", ORG_KEY]])),
  );
  const presented = () => request({ authorization: "Bearer sk-lw-aggregate" });

  it("refuses it at the project door with the aggregate's own code", async () => {
    expect(await refusalCode(aggregateDoor.identify({ request: presented() }))).toBe(
      "aggregate_project_has_no_credential",
    );
  });

  it("refuses it at the key door, rather than falling back to its organization", async () => {
    expect(await refusalCode(aggregateDoor.identifyKey({ request: presented() }))).toBe(
      "aggregate_project_has_no_credential",
    );
  });
});
