/**
 * The key door (#8085): any API key authenticates without naming a project, and resolves to the
 * principal the query door fans out from. Only a missing or unusable token is refused.
 */
import type {
  ApiKeyApi,
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
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
  "findResolvedToken" | "resolveOrganizationToken" | "markUsed"
> {
  readonly used: string[] = [];

  constructor(
    private readonly projectTokens: ReadonlyMap<string, ResolvedApiKeyCredential>,
    private readonly organizationTokens: ReadonlyMap<string, OrganizationApiKeyResolution>,
  ) {}

  findResolvedToken({
    token,
  }: ApiKeyTokenResolutionInput): Promise<ResolvedApiKeyCredential | null> {
    return Promise.resolve(this.projectTokens.get(token) ?? null);
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
    it("is refused as missing credentials", async () => {
      expect(await refusalCode(door.identifyKey({ request: request({}) }))).toBe(
        "missing_credentials",
      );
    });
  });

  describe("given a token that resolves to neither a project nor an organization", () => {
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
describe("the project door", () => {
  describe("given a live key that reaches several projects and names none", () => {
    /** @scenario "A key that reaches several projects and names none is told to name one" */
    it.each([
      ["with a permission asked", "authenticate"],
      ["with none asked", "identify"],
    ] as const)("is told to name a project, %s", async (_name, method) => {
      const asked = request({ authorization: "Bearer sk-lw-org" });

      expect(await refusalCode(door[method]({ request: asked, permission: "traces:view" }))).toBe(
        "project_required",
      );
    });
  });

  describe("given a live key that names a project it does not resolve", () => {
    it("stays an invalid credential, saying nothing about the project", async () => {
      const asked = request({ authorization: "Bearer sk-lw-org", "x-project-id": "project-9" });

      expect(await refusalCode(door.identify({ request: asked }))).toBe("invalid_credentials");
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
        permission: "traces:view",
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
        permission: "traces:view",
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
          tokenDoor(false).authenticate({ request: bearer, permission: "traces:view" }),
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
