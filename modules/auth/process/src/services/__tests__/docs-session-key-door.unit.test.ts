/**
 * The project door asking a read-only docs session key (ADR-185, amendment of 2026-11-13): the
 * key holds only the member's reads, so a read passes and a write is refused at the door.
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { ALL_PERMISSIONS } from "@langwatch/authorization";
import {
  AuthzEngine,
  type AuthzApi,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ApiRestCredentialsService } from "../api-rest-credentials.service.ts";

const ORGANIZATION_ID = "org-1";
const USER_ID = "member-1";
const KEY_ID = "docs-key-1";
const TOKEN = "sk-lw-docs-read-only";
const PROJECT = {
  id: "project-1",
  name: "Checkout",
  slug: "checkout",
  teamId: "team-1",
  organizationId: ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};
const SCOPE: AuthzScopeRef = {
  type: "project",
  id: PROJECT.id,
  teamId: PROJECT.teamId,
  organizationId: ORGANIZATION_ID,
};

const engine = new AuthzEngine();
const memberGrants: CollectedGrants = {
  principal: { type: "user", id: USER_ID },
  organizationId: ORGANIZATION_ID,
  organizationRole: "MEMBER",
  isOrgMember: true,
  membershipDisabled: false,
  bindings: [{ roleKey: "member", scopeType: "PROJECT", scopeId: PROJECT.id }],
  customRolePermissions: new Map(),
};
/* What a read-only mint hands on: the member's permissions there that only read. */
const readOnly = ALL_PERMISSIONS.filter(
  (permission) =>
    permission.endsWith(":view") &&
    engine.decide({ grants: memberGrants, permission, scope: SCOPE }).allowed,
);
const keyGrants: CollectedGrants = {
  principal: { type: "apiKey", id: KEY_ID },
  organizationId: ORGANIZATION_ID,
  organizationRole: null,
  isOrgMember: false,
  membershipDisabled: false,
  bindings: [{ roleKey: "custom:docs", scopeType: "PROJECT", scopeId: PROJECT.id }],
  customRolePermissions: new Map([["docs", readOnly]]),
};

const resolved: ResolvedApiKeyCredential = {
  type: "apiKey",
  apiKeyId: KEY_ID,
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: PROJECT,
};

/* authz's answer for the key: its own grants, capped by the member's live ones. */
const withinCeiling = (permission: string) =>
  engine.decideWithCeiling({ keyGrants, ownerGrants: memberGrants, permission, scope: SCOPE })
    .allowed;

const door = ApiRestCredentialsService.create({
  apiKeys: {
    getOrgProjects: () => Promise.resolve([]),
    findResolvedToken: ({ token }) => Promise.resolve(token === TOKEN ? resolved : null),
    resolveOrganizationToken: () => Promise.resolve({ ok: false, reason: "unusable_credential" }),
    markUsed: () => {},
  },
  authz: {
    getApiKeyProjectDecision: async ({ permission }) =>
      engine.decideWithCeiling({ keyGrants, ownerGrants: memberGrants, permission, scope: SCOPE })
        .allowed
        ? {
            outcome: "allowed",
            scope: {
              projectId: PROJECT.id,
              teamId: PROJECT.teamId,
              organizationId: ORGANIZATION_ID,
            },
          }
        : { outcome: "denied" },
    hasApiKeyPermission: async ({ permission, scope }) =>
      scope.type === "project" && scope.id === PROJECT.id && withinCeiling(permission),
    hasProjectPermission: () => Promise.reject(new Error("the door asks no person")),
    listApiKeyBindings: () => Promise.resolve([]),
    getScope: () => Promise.reject(new Error("the door reads no scope")),
  } satisfies Pick<
    AuthzApi,
    | "getApiKeyProjectDecision"
    | "hasApiKeyPermission"
    | "hasProjectPermission"
    | "listApiKeyBindings"
    | "getScope"
  >,
  featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
  cliProjects: {
    getCliAccessProject: () => Promise.reject(new Error("the door reads no CLI session")),
  },
  organizations: { getSettings: () => Promise.reject(new Error("no organization read")) },
});

function call({
  method,
  permission,
}: {
  method: string;
  permission: "traces:view" | "traces:update" | "datasets:create";
}) {
  return door.authenticate({
    request: new Request("http://localhost/api/traces", {
      method,
      headers: { "X-Auth-Token": TOKEN },
    }),
    permissions: [permission],
  });
}

describe("given a docs session key the member made read-only", () => {
  /** @scenario "A member grants read-only access" */
  it("passes a route that asks a read", async () => {
    const credential = await call({ method: "GET", permission: "traces:view" });

    expect(credential.resolved).toMatchObject({ type: "apiKey", apiKeyId: KEY_ID });
    expect(credential.project.id).toBe(PROJECT.id);
  });

  /** @scenario "A member grants read-only access" */
  it.each(["traces:update", "datasets:create"] as const)(
    "refuses a route that asks %s with status 403, though the member holds it",
    async (permission) => {
      expect(engine.decide({ grants: memberGrants, permission, scope: SCOPE }).allowed).toBe(true);

      const error = await call({ method: "POST", permission }).then(
        () => null,
        (thrown: unknown) => thrown,
      );

      if (!HandledError.isHandled(error)) throw new Error("the door admitted the key");
      expect(error.httpStatus).toBe(403);
      expect(error.code).toMatch(/permission_denied$/);
    },
  );
});
