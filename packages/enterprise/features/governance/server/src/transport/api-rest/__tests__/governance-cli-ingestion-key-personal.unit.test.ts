// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The personal-workspace branch of the CLI's ingestion-key routes: the mint
 * refuses a source type no wrapped tool stamps, and the lookup route says what
 * became of one of the caller's own keys.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { createAppRestSecurity } from "@langwatch/api/rest";
import { PersonalSourceTypeNotAllowedError } from "@langwatch/enterprise-governance-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createGovernanceCliRestApp, type GovernanceCliRestPorts } from "../governance-cli.api";

const CALLER = {
  user_id: "user_1",
  organization_id: "org_1",
  client_info: { hostname: "laptop" },
};

function mountCli(governance: Record<string, unknown>) {
  const ports = {
    accessTokens: {
      resolve: vi.fn().mockResolvedValue(CALLER),
      revoke: vi.fn(),
    },
    governance: () => ({
      aiToolResolvePolicy: vi.fn().mockResolvedValue({ allowOtelDirect: true }),
      ...governance,
    }),
    directory: () => ({ membershipStatus: vi.fn().mockResolvedValue("active") }),
    database: () => ({}),
    ensurePersonalWorkspace: vi.fn(),
    tryFindPersonalWorkspace: vi.fn().mockResolvedValue(null),
    plans: () => ({}),
    permittedOnOrganization: vi.fn().mockResolvedValue(true),
    permittedOnProject: vi.fn().mockResolvedValue(true),
  } as unknown as GovernanceCliRestPorts;

  const app = createGovernanceCliRestApp({ security: passThroughSecurity(), ports });
  return {
    get: (path: string) =>
      app.fetch(
        new Request(`http://api.test${path}`, {
          headers: { Authorization: "Bearer lw_at_token" },
        }),
      ),
    post: (path: string, body: unknown) =>
      app.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer lw_at_token",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      ),
  };
}

describe("POST /api/auth/cli/governance/ingestion-key for the personal workspace", () => {
  describe("when the CLI submits a source type no wrapped tool stamps", () => {
    /** @scenario "A personal key is minted only for a tool the CLI wraps" */
    it("answers 400 and mints nothing", async () => {
      const issue = vi.fn().mockRejectedValue(new PersonalSourceTypeNotAllowedError("made_up"));
      const api = mountCli({ ingestionKeyIssueForPersonalProject: issue });

      const response = await api.post("/api/auth/cli/governance/ingestion-key", {
        source_type: "made_up",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    });
  });

  describe("when the CLI submits a wrapped tool", () => {
    /** @scenario "Two devices each keep a live personal key for the same tool" */
    it("mints create-only, so no other device's key is rotated away", async () => {
      const issue = vi.fn().mockResolvedValue({
        token: "ik-lw-lookup_secret",
        apiKeyId: "key_1",
        prefix: "ik-lw-lookup",
        sourceType: "claude_code",
      });
      const api = mountCli({ ingestionKeyIssueForPersonalProject: issue });

      const response = await api.post("/api/auth/cli/governance/ingestion-key", {
        source_type: "claude_code",
      });

      expect(response.status).toBe(201);
      expect(issue).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: "claude_code", userId: "user_1" }),
      );
    });
  });
});

describe("GET /api/auth/cli/governance/ingestion-keys/:lookup_id", () => {
  /** @scenario "The CLI can ask what became of its own key" */
  it("answers with the cause for a revoked key, live for a live one", async () => {
    const api = mountCli({
      tryDescribePersonalIngestionKey: vi
        .fn()
        .mockResolvedValueOnce({
          sourceType: "opencode",
          live: false,
          revocationCause: "user",
        })
        .mockResolvedValueOnce({
          sourceType: "opencode",
          live: true,
          revocationCause: null,
        }),
    });

    const revoked = await api.get("/api/auth/cli/governance/ingestion-keys/lookup1");
    const live = await api.get("/api/auth/cli/governance/ingestion-keys/lookup2");

    expect(await revoked.json()).toMatchObject({
      status: "revoked",
      revocation_cause: "user",
    });
    expect(await live.json()).toMatchObject({ status: "live", revocation_cause: null });
  });

  it("answers unknown with a 200 for a lookup id that names none of the caller's keys", async () => {
    const api = mountCli({ tryDescribePersonalIngestionKey: vi.fn().mockResolvedValue(null) });

    const response = await api.get("/api/auth/cli/governance/ingestion-keys/nosuchlookupid");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lookup_id: "nosuchlookupid",
      status: "unknown",
    });
  });
});

const renderHandled: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity() {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}
