/**
 * The management audit trail `/api/api-keys` leaves, through the door registry.
 * Reading one key by id discloses who holds it, so it is audited like a write.
 */
// @vitest-environment node
import type { ApiKeyApi, ApiKeyDetail } from "@langwatch/api-key-contract";
import type { AppRestManagementAuditPort } from "@langwatch/api/rest";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { packagedRestPorts } from "../../../app-rest/__tests__/support/rest-family.harness.ts";
import { openTestRestDoors } from "../../../app-rest/__tests__/support/rest-doors.harness.ts";

const ORGANIZATION_ID = "organization-1";
const API_KEY_ID = "api-key-credential";
const CALLER_USER_ID = "user-caller";
const TARGET_KEY_ID = "api-key-target";

type AuditRow = Parameters<AppRestManagementAuditPort>[0];

describe("given a member's credential on the api-keys family", () => {
  describe("when one key is read by id", () => {
    it("records the disclosure against the member the credential acts as", async () => {
      const world = mountApiKeys({ callerUserId: CALLER_USER_ID });

      const response = await world.send(`/api/api-keys/${TARGET_KEY_ID}`);

      expect(response.status).toBe(200);
      expect(world.audited).toEqual([
        {
          userId: CALLER_USER_ID,
          organizationId: ORGANIZATION_ID,
          action: "management.apiKey.read",
          args: { apiKeyId: TARGET_KEY_ID },
        },
      ]);
    });
  });

  describe("when one key is updated", () => {
    it("records the update rather than the read it answers with", async () => {
      const world = mountApiKeys({ callerUserId: CALLER_USER_ID });

      const response = await world.send(`/api/api-keys/${TARGET_KEY_ID}`, {
        method: "PATCH",
        body: { name: "renamed" },
      });

      expect(response.status).toBe(200);
      expect(world.audited.map((row) => row.action)).toEqual(["management.apiKey.update"]);
    });
  });
});

describe("given a service credential on the api-keys family", () => {
  describe("when one key is read by id", () => {
    it("records the credential itself, because a service key acts as nobody", async () => {
      const world = mountApiKeys({ callerUserId: null });

      const response = await world.send(`/api/api-keys/${TARGET_KEY_ID}`);

      expect(response.status).toBe(200);
      expect(world.audited.map((row) => row.userId)).toEqual([`apikey:${API_KEY_ID}`]);
    });
  });
});

// ---------------------------------------------------------------------------

function apiKeyDetail(): ApiKeyDetail {
  return {
    id: TARGET_KEY_ID,
    name: "Deploy key",
    description: null,
    organizationId: ORGANIZATION_ID,
    userId: CALLER_USER_ID,
    createdByUserId: CALLER_USER_ID,
    createdByDeviceLabel: null,
    lookupId: "lookup-1",
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    roleBindings: [],
    permissions: [],
  };
}

/** The family as the process serves it: through the door registry, and no other way. */
function mountApiKeys(options: { callerUserId: string | null }) {
  const audited: AuditRow[] = [];
  const apiKeys = {
    isOrgAdmin: () => Promise.resolve(true),
    isOrgAdminApiKey: () => Promise.resolve(true),
    credentialCanManageOrganization: () => Promise.resolve(true),
    getByIdForCaller: () => Promise.resolve(apiKeyDetail()),
    update: () => Promise.resolve(apiKeyDetail()),
  } as ApiKeyApi;

  const hono = new Hono();
  const doors = openTestRestDoors({
    packaged: {
      services: { apiKeys: () => apiKeys },
      ports: packagedRestPorts({
        managementAudit: (entry) => {
          audited.push(entry);
        },
      }),
    },
    organizationCredential: () =>
      Promise.resolve({
        ok: true,
        resolved: {
          type: "apiKey-org",
          apiKeyId: API_KEY_ID,
          userId: options.callerUserId,
          organizationId: ORGANIZATION_ID,
        },
        markUsed: () => {},
      }),
  });

  for (const door of doors) hono.route("/", door);

  return {
    audited,
    send: (path: string, init: { method?: string; body?: unknown } = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: { "Content-Type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      ),
  };
}
