/**
 * The installation flow's own routes: /install signs state for the session that
 * started it, /setup binds the installation to that state before recording, and
 * /webhook verifies GitHub's HMAC before anything is applied. The legacy
 * `/github-langy/*` aliases are exercised because the App registrations we do
 * not own still point at them.
 * @see specs/integrations/github-connection.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type {
  GithubAppConfig,
  GithubInstallStatePayload,
  GithubService,
} from "@langwatch/github-contract";
import { createHmac } from "node:crypto";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GithubInstallStateAdapter } from "../../../adapters/github-install-state.adapter";
import { createGithubRestApp, type GithubRestPorts } from "../github.api";

const SIGNING_KEY = "x".repeat(64);
const WEBHOOK_SECRET = "whsecret";
const INSTALL_URL = "https://github.com/apps/langwatch/installations/new";

const state = GithubInstallStateAdapter.create({ signingKey: SIGNING_KEY, redis: null });

const appConfig: GithubAppConfig = {
  appSlug: "langwatch",
  webhookSecret: WEBHOOK_SECRET,
  configured: true,
};

function signedState(overrides: Partial<GithubInstallStatePayload> = {}): string {
  return state.sign({
    userId: "user_1",
    organizationId: "org_1",
    mode: "redirect",
    returnTo: "/settings/integrations#github",
    issuedAt: Date.now(),
    nonce: "nonce_1",
    nonceRegistered: false,
    ...overrides,
  });
}

function mount(
  options: {
    member?: boolean;
    canManage?: boolean;
    session?: { user: { id: string } } | null;
  } = {},
) {
  const recorded: Array<{ installationId: string; organizationId: string }> = [];
  const webhookEvents: Array<{ action: string; installationId: string }> = [];
  const audits: Array<{ action: string }> = [];

  const service = {
    getAppConfig: () => appConfig,
    getAppInstallUrl: () => INSTALL_URL,
    getInstallStateTtlMs: () => state.getTtlMs(),
    registerInstallNonce: vi.fn(async () => false),
    tryConsumeInstallNonce: vi.fn(async () => true),
    signInstallState: (payload: GithubInstallStatePayload) => state.sign(payload),
    tryVerifyInstallState: (token: string | null) => state.tryVerify(token),
    popupResponseHtml: (login: string) => `<p>${login}</p>`,
    popupErrorHtml: (message: string) => `<p>${message}</p>`,
    isOrganizationMember: vi.fn(async () => options.member ?? true),
    recordInstallation: vi.fn(async (input: { installationId: string; organizationId: string }) => {
      recorded.push({
        installationId: input.installationId,
        organizationId: input.organizationId,
      });
      return { accountLogin: "acme" };
    }),
    handleWebhookEvent: vi.fn(async (input: { action: string; installationId: string }) => {
      webhookEvents.push({ action: input.action, installationId: input.installationId });
    }),
    tryParsePullRequestEvent: () => null,
    applyPullRequestEvent: vi.fn(async () => true),
  };

  const ports: GithubRestPorts = {
    github: () => service as unknown as GithubService,
    session: async () =>
      options.session === undefined ? { user: { id: "user_1" } } : options.session,
    canManageOrganization: async () => options.canManage ?? true,
    audit: async (entry) => {
      audits.push({ action: entry.action });
    },
  };

  const hono = new Hono().route(
    "/",
    createGithubRestApp({ security: passthroughSecurity(), ports }),
  );

  return {
    service,
    recorded,
    webhookEvents,
    audits,
    install: (query: string) =>
      hono.fetch(new Request(`http://api.test/api/github/install?${query}`)),
    setup: (path: string, query: string) =>
      hono.fetch(new Request(`http://api.test/api${path}?${query}`)),
    webhook: (
      path: string,
      body: unknown,
      webhookOptions: { signature?: string; event?: string } = {},
    ) => {
      const raw = JSON.stringify(body);
      const signature =
        webhookOptions.signature ??
        `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")}`;
      return hono.fetch(
        new Request(`http://api.test/api${path}`, {
          method: "POST",
          body: raw,
          headers: {
            "content-type": "application/json",
            "x-github-event": webhookOptions.event ?? "installation_repositories",
            "x-hub-signature-256": signature,
          },
        }),
      );
    },
  };
}

const renderError: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

/**
 * The door's own checks are exercised by the security suite; these routes carry
 * their session and permission checks in the handler, which is what this pins.
 */
function passthroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderError,
    canonicalErrorHandler: renderError,
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

describe("given the GitHub installation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when an organization manager starts an installation", () => {
    /** @scenario Starting an installation redirects to GitHub with signed state */
    it("redirects to GitHub carrying state bound to the session and organization", async () => {
      const api = mount();

      const response = await api.install("organizationId=org_1");

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(`${location.origin}${location.pathname}`).toBe(INSTALL_URL);
      expect(state.tryVerify(location.searchParams.get("state"))).toMatchObject({
        userId: "user_1",
        organizationId: "org_1",
      });
    });

    /** @scenario Connecting is not gated by the Langy rollout */
    it("begins the flow with no Langy capability consulted at all", async () => {
      const api = mount();

      const response = await api.install("organizationId=org_1");

      expect(response.status).toBe(302);
      // The only questions asked are membership and organization management:
      // an organization with no Langy access reaches GitHub exactly the same way.
      expect(api.service.isOrganizationMember).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
      });
    });
  });

  describe("when GitHub redirects back to the setup callback", () => {
    /** @scenario Completing an installation records the installation for my org */
    it("records the installation against the organization the state names", async () => {
      const api = mount();

      const response = await api.setup(
        "/github/setup",
        `state=${encodeURIComponent(signedState())}&installation_id=555`,
      );

      expect(response.status).toBe(302);
      expect(api.recorded).toEqual([{ installationId: "555", organizationId: "org_1" }]);
      expect(api.audits).toEqual([{ action: "github.connection.install" }]);
    });

    /** @scenario The setup callback on the legacy path still records */
    it("records the same installation through the legacy github-langy path", async () => {
      const api = mount();

      const response = await api.setup(
        "/github-langy/setup",
        `state=${encodeURIComponent(signedState())}&installation_id=777`,
      );

      expect(response.status).toBe(302);
      expect(api.recorded).toEqual([{ installationId: "777", organizationId: "org_1" }]);
    });

    /** @scenario Setup callback rejects a tampered or expired state */
    it("records nothing and reports the failure when the state does not verify", async () => {
      const api = mount();

      const response = await api.setup(
        "/github/setup",
        `state=${encodeURIComponent(`${signedState()}tampered`)}&installation_id=555`,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Invalid state or missing installation");
      expect(api.service.recordInstallation).not.toHaveBeenCalled();
      expect(api.recorded).toEqual([]);
    });
  });

  describe("when GitHub delivers a webhook", () => {
    /** @scenario The webhook on the legacy path still applies */
    it("applies a signed installation_repositories event on the legacy path", async () => {
      const api = mount();

      const response = await api.webhook("/github-langy/webhook", {
        action: "added",
        installation: { id: 555 },
      });

      expect(response.status).toBe(200);
      expect(api.webhookEvents).toEqual([{ action: "added", installationId: "555" }]);
    });

    /** @scenario Webhook rejects an unsigned or wrongly signed payload */
    it("refuses a payload whose signature does not match and applies nothing", async () => {
      const api = mount();

      const wrong = await api.webhook(
        "/github/webhook",
        { action: "added", installation: { id: 555 } },
        { signature: `sha256=${"0".repeat(64)}` },
      );
      expect(wrong.status).toBe(401);

      const unsigned = await api.webhook(
        "/github/webhook",
        { action: "added", installation: { id: 555 } },
        { signature: "" },
      );
      expect(unsigned.status).toBe(401);

      expect(api.service.handleWebhookEvent).not.toHaveBeenCalled();
      expect(api.webhookEvents).toEqual([]);
    });
  });
});
