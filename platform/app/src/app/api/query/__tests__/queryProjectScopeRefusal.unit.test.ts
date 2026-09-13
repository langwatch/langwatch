/**
 * The query door's project-scoping refusal (issue #8085).
 *
 * Both `POST /api/v1/query` and `GET /api/v1/query/schema` install the same
 * `createUnifiedAuthMiddleware`, so a caller whose key verifies but binds to
 * no single project must be refused BEFORE either handler runs — no
 * database, no LangWatchQL service, exactly like the anonymous-caller cases
 * in `./queryRest.unit.test.ts`, which this file sits beside.
 *
 * `ApiKeyService` is the boundary faked (the real DB-backed lookup); the real
 * `queryApp`, `TokenResolver` and `createUnifiedAuthMiddleware` run unmocked,
 * so this is the actual assembled door, not a stand-in for it.
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see ./queryRest.unit.test.ts — the sibling suite this one is modeled on
 * @see ../../../../server/api-key/auth-middleware.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType } from "~/generated/prisma/client";

// `resolveApiKey` falls back to a legacy-project-key lookup (`prisma.project.
// findUnique`) whenever the API-key path itself resolves to null — including
// the ambiguous "no project scope" case this file drives — so the stub needs
// that method even though every case here is a real `sk-lw-` API key.
vi.mock("~/server/db", () => ({
  prisma: { project: { findUnique: vi.fn().mockResolvedValue(null) } },
}));

// `canonicalAuthMiddleware` (in `~/app/api/middleware/auth.ts`) builds
// `TokenResolver.create(prisma)` — and therefore `ApiKeyService.create()` —
// at MODULE LOAD TIME, before this file's own top-level statements run.
// `vi.hoisted` is what lets the mock factory below close over `verify` and
// `markUsed` without a temporal-dead-zone reference.
const { verify, markUsed } = vi.hoisted(() => ({
  verify: vi.fn(),
  markUsed: vi.fn(),
}));

vi.mock("../../../../server/api-key/api-key.service", () => ({
  ApiKeyService: {
    create: () => ({ verify, markUsed }),
  },
}));

import { app as queryApp } from "../[[...route]]/app";

const RUN_PATH = "/api/v1/query";
const SCHEMA_PATH = "/api/v1/query/schema";

/**
 * A syntactically valid new-format API key token (`sk-lw-{16 alnum}_{48
 * alnum}`) — `getTokenType` classifies anything else as a legacy project
 * key, since the new-format body is alphanumeric-only.
 */
function apiKeyToken(seed: string): string {
  const alnum = seed.replace(/[^0-9A-Za-z]/g, "");
  const lookup = alnum.padEnd(16, "0").slice(0, 16);
  const secret = alnum.padEnd(48, "1").slice(0, 48);
  return `sk-lw-${lookup}_${secret}`;
}

const ORG_ONLY_TOKEN = apiKeyToken("org-only");

function orgOnlyApiKey() {
  return {
    id: "key_org_only",
    userId: "user_1",
    organizationId: "org_1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    name: "org key",
    roleBindings: [
      { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: null },
    ],
  };
}

async function callDoor(path: string, token: string) {
  const response = await queryApp.request(path, {
    method: path === RUN_PATH ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(path === RUN_PATH ? { body: JSON.stringify({ sql: "SELECT 1" }) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  verify.mockReset();
  markUsed.mockReset();
});

describe("given an API key that verifies but binds to no single project", () => {
  beforeEach(() => {
    verify.mockResolvedValue(orgOnlyApiKey());
  });

  describe("when it calls either door with no X-Project-Id and no Basic-auth project id", () => {
    /** @scenario "An organization-scoped key with no project hint is refused with a self-describing error" */
    /** @scenario "The schema endpoint applies the same project scoping refusal" */
    it.each([
      ["POST /api/v1/query", RUN_PATH],
      ["GET /api/v1/query/schema", SCHEMA_PATH],
    ])("refuses %s with 401 project_scope_required", async (_label, path) => {
      const { status, body } = await callDoor(path, ORG_ONLY_TOKEN);

      expect(status).toBe(401);
      expect(body.error?.code).toBe("project_scope_required");
    });

    it.each([
      ["POST /api/v1/query", RUN_PATH],
      ["GET /api/v1/query/schema", SCHEMA_PATH],
    ])("tells the caller on %s to send X-Project-Id or Basic auth with the project id", async (_label, path) => {
      const { body } = await callDoor(path, ORG_ONLY_TOKEN);

      expect(body.error?.message).toMatch(/X-Project-Id/);
      expect(body.error?.message).toMatch(/basic auth/i);
    });

    it.each([
      ["POST /api/v1/query", RUN_PATH],
      ["GET /api/v1/query/schema", SCHEMA_PATH],
    ])("carries meta.required and meta.accepted on %s", async (_label, path) => {
      const { body } = await callDoor(path, ORG_ONLY_TOKEN);

      expect(body.error?.meta?.required).toBe("project_scope");
      expect(body.error?.meta?.accepted).toEqual(
        expect.arrayContaining(["X-Project-Id", "basic_auth_project_id"]),
      );
    });
  });
});

describe("given three keys: one unknown, one revoked, and one with the wrong secret", () => {
  /** @scenario "An unknown, revoked, and wrong-secret key all get one identical, vague refusal" */
  it("answers all three with one identical HTTP 401 invalid_credentials body", async () => {
    // The three cases collapse to the same outcome at the real DB boundary
    // (`ApiKeyService.verify`): none of them resolves to a key. Distinct
    // input tokens stand in for "never existed", "revoked", and "secret
    // mismatch" — the difference lives inside the mocked boundary, and the
    // claim under test is that none of it leaks past it.
    verify.mockResolvedValue(null);

    const unknown = await callDoor(RUN_PATH, apiKeyToken("unknown-key"));
    const revoked = await callDoor(RUN_PATH, apiKeyToken("revoked-key"));
    const wrongSecret = await callDoor(RUN_PATH, apiKeyToken("wrong-secret"));

    for (const outcome of [unknown, revoked, wrongSecret]) {
      expect(outcome.status).toBe(401);
      expect(outcome.body.error?.code).toBe("invalid_credentials");
    }
    expect(unknown.body).toEqual(revoked.body);
    expect(unknown.body).toEqual(wrongSecret.body);
  });

  it("never answers the project_scope_required body for any of the three", async () => {
    verify.mockResolvedValue(null);

    const { body } = await callDoor(RUN_PATH, apiKeyToken("unknown-key"));

    expect(body.error?.code).not.toBe("project_scope_required");
  });
});
