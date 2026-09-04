// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @see packages/enterprise/features/scim/specs/scim.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { ScimService } from "@langwatch/enterprise-scim-contract";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createScimWebhookRestApp } from "../scim-webhook-intake.api";

const SECRET = "deployment-shared-secret";
const NOW = new Date("2026-09-04T10:00:00.000Z");

const createEvent = [
  {
    type: "sscim",
    description: "create",
    details: { userName: "ada@victim-domain.com", body: { name: { givenName: "Ada" } } },
  },
];

class ScimServiceFake extends ScimService {
  readonly verifyToken = vi.fn(async ({ token }: { token: string }) =>
    token === "scim_token_attacker"
      ? ({ status: "ok", organizationId: "org_attacker", connectionId: null } as const)
      : token === "scim_token_victim"
        ? ({ status: "ok", organizationId: "org_victim", connectionId: null } as const)
        : ({ status: "invalid_token" } as const),
  );
  readonly createUser = vi.fn(async () => ({}) as never);
  readonly tryFindOrganizationBySsoDomain = vi.fn(async () => ({ id: "org_victim" }));
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

function signature(body: string, options: { secret?: string; atSeconds?: number } = {}): string {
  const t = options.atSeconds ?? Math.floor(NOW.getTime() / 1000);
  const digest = createHmac("sha256", options.secret ?? SECRET)
    .update(`${t}.${body}`)
    .digest("hex");
  return `t=${t},v1=${digest}`;
}

function mount(options: { secret?: string | undefined } = {}) {
  const scim = new ScimServiceFake();
  const hono = new Hono().route(
    "/",
    createScimWebhookRestApp({
      security: passThroughSecurity(),
      ports: {
        scim: () => scim,
        webhookSecret: () => ("secret" in options ? options.secret : SECRET),
        now: () => NOW,
      },
    }),
  );
  return {
    scim,
    post: (init: { body: unknown; headers?: Record<string, string> }) => {
      const body = JSON.stringify(init.body);
      return hono.fetch(
        new Request("http://api.test/api/webhooks/auth0-scim", {
          method: "POST",
          body,
          headers: { "content-type": "application/json", ...init.headers },
        }),
      );
    },
    sign: signature,
  };
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

describe("given the Auth0 SCIM webhook intake", () => {
  describe("when the delivery is signed and carries a directory token", () => {
    // @scenario "A signed SCIM webhook delivery provisions the token's own organization"
    it("provisions the organization the credential names, not the one the payload implies", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: {
          authorization: "Bearer scim_token_attacker",
          "x-langwatch-signature": signature(JSON.stringify(body)),
        },
      });

      expect(response.status).toBe(200);
      expect(api.scim.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_attacker" }),
      );
      expect(api.scim.tryFindOrganizationBySsoDomain).not.toHaveBeenCalled();
    });
  });

  describe("when the delivery presents no directory token", () => {
    // @scenario "A SCIM webhook delivery without a directory token provisions nothing"
    it("refuses the delivery and provisions nothing", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: { "x-langwatch-signature": signature(JSON.stringify(body)) },
      });

      expect(response.status).toBe(401);
      expect(api.scim.createUser).not.toHaveBeenCalled();
    });
  });

  describe("when the presented secret is not the configured one", () => {
    // @scenario "A SCIM webhook delivery signed with the wrong secret is refused"
    it("refuses a delivery signed with another secret", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: {
          authorization: "Bearer scim_token_attacker",
          "x-langwatch-signature": signature(JSON.stringify(body), { secret: "guessed" }),
        },
      });

      expect(response.status).toBe(401);
      expect(api.scim.createUser).not.toHaveBeenCalled();
    });
  });

  describe("when a captured delivery is sent twice", () => {
    // @scenario "A replayed SCIM webhook delivery is refused"
    it("refuses the replay", async () => {
      const api = mount();
      const body = createEvent;
      const headers = {
        authorization: "Bearer scim_token_attacker",
        "x-langwatch-signature": signature(JSON.stringify(body)),
      };

      const first = await api.post({ body, headers });
      const second = await api.post({ body, headers });

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(api.scim.createUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the delivery is older than the freshness window", () => {
    // @scenario "A SCIM webhook delivery outside the freshness window is refused"
    it("refuses a stale timestamp", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: {
          authorization: "Bearer scim_token_attacker",
          "x-langwatch-signature": signature(JSON.stringify(body), {
            atSeconds: Math.floor(NOW.getTime() / 1000) - 3600,
          }),
        },
      });

      expect(response.status).toBe(401);
      expect(api.scim.createUser).not.toHaveBeenCalled();
    });
  });

  describe("when the deployment configured no webhook secret", () => {
    // @scenario "A deployment without directory sync does not serve the SCIM webhook"
    it("answers as though the path does not exist", async () => {
      const api = mount({ secret: undefined });

      const response = await api.post({ body: createEvent });

      expect(response.status).toBe(404);
    });
  });
});
