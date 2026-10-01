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

import { ApiRestCredentials, type ApiRestCredentialPeers } from "../credentials.ts";

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

function doorOver(store: KeyStore): ApiRestCredentials {
  const peers: ApiRestCredentialPeers = {
    apiKeys: store,
    authz: {
      hasApiKeyPermission: () => Promise.reject(new Error("the key door asks no permission")),
      getApiKeyProjectDecision: () => Promise.reject(new Error("the key door asks no permission")),
    },
    organizations: {
      getSettings: () => Promise.reject(new Error("the key door reads no organization")),
    },
  };

  return ApiRestCredentials.create(peers);
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
