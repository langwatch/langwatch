/**
 * The key door asking a route's permission: at the project a key acts in, at its organization,
 * or on any scope it is granted at. A refusal is the one permission denial every tier gives.
 * @see specs/ai-gateway/public-rest-api.feature
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */
import type {
  ApiKeyApi,
  OrganizationApiKeyResolution,
  ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ApiRestCredentialsService,
  type ApiKeyPermissionReach,
} from "../api-rest-credentials.service.ts";

const ORGANIZATION_ID = "org-1";
const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
};

const projectTokens = new Map<string, ResolvedApiKeyCredential>([
  ["legacy-key", { type: "legacyProjectKey", project: PROJECT }],
  [
    "sk-lw-project",
    {
      type: "apiKey",
      apiKeyId: "key-project",
      userId: "user-1",
      organizationId: ORGANIZATION_ID,
      ingestSourceType: null,
      ingestionTemplateId: null,
      project: PROJECT,
    },
  ],
]);
const organizationTokens = new Map<string, OrganizationApiKeyResolution>([
  [
    "sk-lw-org",
    {
      ok: true,
      resolved: {
        type: "apiKey-org",
        apiKeyId: "key-org",
        userId: "user-1",
        organizationId: ORGANIZATION_ID,
      },
    },
  ],
]);

const apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "resolveOrganizationToken" | "markUsed"> = {
  findResolvedToken: ({ token }) => Promise.resolve(projectTokens.get(token) ?? null),
  resolveOrganizationToken: ({ token }) =>
    Promise.resolve(
      organizationTokens.get(token) ?? { ok: false, reason: "unusable_credential" as const },
    ),
  markUsed: () => {},
};

type Grant = Readonly<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;

/** Every scope the door asked, and the scopes that answer yes. */
const asked: string[] = [];
let held: readonly string[] = [];
let grants: readonly Grant[] = [];

function answer(address: string): Promise<boolean> {
  asked.push(address);

  return Promise.resolve(held.includes(address));
}

const authz = {
  hasApiKeyPermission: ({ scope }) => answer(`${scope.type}:${scope.id}`),
  getApiKeyProjectDecision: async ({ projectId }) =>
    (await answer(`project:${projectId}`))
      ? {
          outcome: "allowed",
          scope: { projectId, teamId: PROJECT.teamId, organizationId: ORGANIZATION_ID },
        }
      : { outcome: "denied" },
  hasProjectPermission: ({ userId, projectId }) => answer(`person:${userId}@${projectId}`),
  listApiKeyBindings: () => Promise.resolve(grants as never),
} satisfies Pick<
  AuthzApi,
  "hasApiKeyPermission" | "getApiKeyProjectDecision" | "hasProjectPermission" | "listApiKeyBindings"
>;

const door = ApiRestCredentialsService.create({
  apiKeys,
  authz,
  cliProjects: {
    getCliAccessProject: () =>
      Promise.resolve({ userId: "user-9", organizationId: ORGANIZATION_ID, project: PROJECT }),
  },
  organizations: { getSettings: () => Promise.reject(new Error("no organization read")) },
});

function ask(token: string, reach?: ApiKeyPermissionReach) {
  return door.authenticateKey({
    request: new Request("http://localhost/api/gateway/v1/virtual-keys", {
      headers: { authorization: `Bearer ${token}` },
    }),
    permissions: ["virtualKeys:view"],
    ...(reach ? { reach } : {}),
  });
}

async function refusal(attempt: Promise<unknown>): Promise<{ code: string; tier: unknown }> {
  const error = await attempt.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!HandledError.isHandled(error)) throw new Error("the door admitted the key");

  return { code: error.code, tier: error.meta?.scopeType };
}

describe("the key door asking a permission", () => {
  beforeEach(() => {
    asked.length = 0;
    held = [];
    grants = [];
  });

  describe("given a key that names a project", () => {
    /** @scenario "A key acting in one project is asked the route's permission at that project" */
    /** @scenario "A project key keeps reading budgets at its own project" */
    it("asks at that project and admits a key that holds it", async () => {
      held = ["project:project-1"];

      const credential = await ask("sk-lw-project", "grants");

      expect(asked).toEqual(["project:project-1"]);
      expect(credential.principal).toMatchObject({ kind: "apiKey", apiKeyId: "key-project" });
    });

    /** @scenario "A key acting in one project is asked the route's permission at that project" */
    it("refuses a key without it as a permission denial at that project", async () => {
      expect(await refusal(ask("sk-lw-project"))).toEqual({
        code: "permission_denied",
        tier: "project",
      });
    });

    /** @scenario "A budget write is asked at the organization whatever project the key names" */
    /** @scenario "A budget write is checked at the organization whatever key calls it" */
    it("asks at the organization when the route says so", async () => {
      held = ["project:project-1"];

      expect(await refusal(ask("sk-lw-project", "organization"))).toEqual({
        code: "permission_denied",
        tier: "organization",
      });
      expect(asked).toEqual([`org:${ORGANIZATION_ID}`]);
    });
  });

  describe("given a project-bound access token", () => {
    /** @scenario "A key acting in one project is asked the route's permission at that project" */
    it("asks the person's own access at the bound project", async () => {
      held = ["person:user-9@project-1"];

      const credential = await ask("lw_at_session", "grants");

      expect(asked).toEqual(["person:user-9@project-1"]);
      expect(credential.principal).toMatchObject({ kind: "cliAccessToken", userId: "user-9" });
    });

    /** @scenario "A budget write is asked at the organization whatever project the key names" */
    it("holds nothing organization-wide", async () => {
      held = ["person:user-9@project-1"];

      expect((await refusal(ask("lw_at_session", "organization"))).code).toBe("permission_denied");
      expect(asked).toEqual([]);
    });
  });

  describe("given a key that names no project", () => {
    /** @scenario "An organization key with no project lists the organization's budgets" */
    it("asks at its organization when the route names no reach", async () => {
      held = [`org:${ORGANIZATION_ID}`];

      await ask("sk-lw-org");

      expect(asked).toEqual([`org:${ORGANIZATION_ID}`]);
    });

    /** @scenario "A key without the budget permission is refused by permission, not as a bad key" */
    it("is refused by permission at its organization when it does not hold it there", async () => {
      expect(await refusal(ask("sk-lw-org"))).toEqual({
        code: "permission_denied",
        tier: "organization",
      });
    });

    /** @scenario "A key that names no project passes a virtual key route on any scope it is granted at" */
    it("passes on one granted scope that holds the permission", async () => {
      grants = [
        { scopeType: "TEAM", scopeId: "team-1" },
        { scopeType: "PROJECT", scopeId: "project-2" },
      ];
      held = ["project:project-2"];

      await ask("sk-lw-org", "grants");

      expect(asked.toSorted()).toEqual(["project:project-2", "team:team-1"]);
    });

    /** @scenario "A key that holds a virtual key permission on none of its grants is refused" */
    it("is refused when no granted scope holds it", async () => {
      grants = [{ scopeType: "TEAM", scopeId: "team-1" }];

      expect(await refusal(ask("sk-lw-org", "grants"))).toEqual({
        code: "permission_denied",
        tier: "organization",
      });
    });

    it("is refused when it holds no grant at all", async () => {
      expect((await refusal(ask("sk-lw-org", "grants"))).code).toBe("permission_denied");
      expect(asked).toEqual([]);
    });
  });

  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key passes the key door by its class" */
    it.each([void 0, "grants", "organization"] as const)(
      "is admitted with no grant asked (reach %s)",
      async (reach) => {
        const credential = await ask("legacy-key", reach);

        expect(credential.principal).toEqual({ kind: "project", projectId: "project-1" });
        expect(asked).toEqual([]);
      },
    );
  });
});
