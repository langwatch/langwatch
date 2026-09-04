// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @see specs/api-reference/scim-api-reference.feature
 *
 * SCIM Groups provision LangWatch access groups (the Group model), not
 * Teams. The /Schemas discovery copy is what an IdP administrator reads
 * when wiring provisioning, so it must name the right resource.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { ScimService } from "@langwatch/enterprise-scim-contract";
import { Hono } from "hono";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createScimProtocolRestApp } from "../scim-protocol.api";

class ScimServiceFake extends ScimService {
  readonly verifyToken = vi.fn(async () => ({ status: "invalid_token" }) as const);
  readonly createUser = vi.fn();
  readonly tryFindOrganizationBySsoDomain = vi.fn();
  readonly listUsers = vi.fn();
  readonly deleteUser = vi.fn();
  readonly generateToken = vi.fn();
  readonly listTokens = vi.fn();
  readonly revokeToken = vi.fn();
  readonly revokeTokensForConnection = vi.fn();
  readonly getUser = vi.fn();
  readonly replaceUser = vi.fn();
  readonly updateUser = vi.fn();
  readonly listGroups = vi.fn();
  readonly getGroup = vi.fn();
  readonly createGroup = vi.fn();
  readonly replaceGroup = vi.fn();
  readonly updateGroup = vi.fn();
  readonly deleteGroup = vi.fn();
}

const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("This family resolves its own credential.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

function mount() {
  const scim = new ScimServiceFake();
  const hono = new Hono().route(
    "/",
    createScimProtocolRestApp({ security: passThroughSecurity(), scim: () => scim }),
  );
  return {
    get: (path: string) => hono.fetch(new Request(`http://api.test${path}`)),
  };
}

describe("Feature: SCIM API reference", () => {
  describe("when an identity provider requests GET /api/scim/v2/Schemas", () => {
    /** @scenario "The SCIM schema describes groups as access groups" */
    it("describes the Group resource as a LangWatch access group", async () => {
      const api = mount();
      const res = await api.get("/api/scim/v2/Schemas");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { Resources: { id: string; description: string }[] };
      const groupSchema = body.Resources.find(
        (resource) => resource.id === "urn:ietf:params:scim:schemas:core:2.0:Group",
      );

      expect(groupSchema).toBeDefined();
      expect(groupSchema?.description).toBe("Group (maps to a LangWatch access group)");
      expect(groupSchema?.description).not.toContain("Team");
    });
  });
});
