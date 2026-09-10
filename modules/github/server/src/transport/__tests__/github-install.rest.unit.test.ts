/**
 * @vitest-environment node
 * The installation flow's routes and their `/github-langy/*` aliases.
 * @see specs/integrations/github-connection.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type {
  GithubApi,
  GithubAppConfig,
  GithubInstallStatePayload,
} from "@langwatch/github-contract";
import { createHmac } from "node:crypto";
import type { ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { GithubInstallStateService } from "../../services/github-install-state.service.ts";
import { GithubInstallNonceRedisRepository } from "../../repositories/redis/redis.github-install-nonce.repository.ts";
import { githubInstallRest, type GithubInstallApi } from "../github-install.rest.ts";

const SIGNING_KEY = "x".repeat(64);
const WEBHOOK_SECRET = "whsecret";
const INSTALL_URL = "https://github.com/apps/langwatch/installations/new";

const state = GithubInstallStateService.create({
  signingKey: SIGNING_KEY,
  nonces: GithubInstallNonceRedisRepository.create({ redis: null }),
});

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

function githubStub(overrides: Partial<GithubApi>): GithubApi {
  return overrides as GithubApi;
}

/** Every refusal these routes word is an answer, so nothing should reach here. */
const renderError: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function mount(
  options: {
    member?: boolean;
    canManage?: boolean;
    configured?: boolean;
    session?: { user: { id: string } } | null;
  } = {},
) {
  const recorded: Array<{ installationId: string; organizationId: string }> = [];
  const webhookEvents: Array<{ action: string; installationId: string }> = [];
  const memberChecks: Array<{ userId: string; organizationId: string }> = [];
  const audits: Array<{ action: string }> = [];
  const sessionReads = { count: 0 };

  const service: Partial<GithubApi> = {
    getAppConfig: () => ({ ...appConfig, configured: options.configured ?? true }),
    getAppInstallUrl: () => INSTALL_URL,
    getInstallStateTtlMs: () => state.getTtlMs(),
    registerInstallNonce: async () => false,
    tryConsumeInstallNonce: async () => true,
    signInstallState: (payload) => state.sign(payload),
    tryVerifyInstallState: (token) => state.tryVerify(token),
    popupResponseHtml: (login) => `<p>${login}</p>`,
    popupErrorHtml: (message) => `<p>${message}</p>`,
    isOrganizationMember: async ({ userId, organizationId }) => {
      memberChecks.push({ userId, organizationId });

      return options.member ?? true;
    },
    recordInstallation: async (input) => {
      recorded.push({
        installationId: input.installationId,
        organizationId: input.organizationId,
      });

      return { accountLogin: "acme" };
    },
    handleWebhookEvent: async (input) => {
      webhookEvents.push({ action: input.action, installationId: input.installationId });
    },
    tryParsePullRequestEvent: () => null,
    applyPullRequestEvent: async () => true,
  };

  const installation: GithubInstallApi = {
    github: () => githubStub(service),
    resolveSession: async () => {
      sessionReads.count += 1;

      return options.session === undefined ? { user: { id: "user_1" } } : options.session;
    },
    canManageOrganization: async () => options.canManage ?? true,
    recordAudit: async (entry) => {
      audits.push({ action: entry.action });
    },
    backfillPullRequestMappings: async () => {},
  };

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The GitHub installation flow answers with no credential resolved.");
      },
    },
  });

  const app = runtime.mount(githubInstallRest.router(), {
    app: () => installation,
    onError: renderError,
  });

  return {
    recorded,
    webhookEvents,
    memberChecks,
    audits,
    sessionReads,
    install: (query: string) =>
      app.fetch(new Request(`http://api.test/api/github/install?${query}`)),
    setup: (path: string, query: string) =>
      app.fetch(new Request(`http://api.test/api${path}?${query}`)),
    webhook: (
      path: string,
      body: unknown,
      webhookOptions: { signature?: string; event?: string } = {},
    ) => {
      const raw = JSON.stringify(body);
      const signature =
        webhookOptions.signature ??
        `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")}`;

      return app.fetch(
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

describe("given the declared installation family", () => {
  it("answers at exactly the addresses the App registrations point at", () => {
    const declaration = githubInstallRest.router();

    expect(declaration.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`)).toEqual(
      [
        "GET /api/github/install",
        "GET /api/github/setup",
        "POST /api/github/webhook",
        "GET /api/github-langy/setup",
        "POST /api/github-langy/webhook",
      ],
    );
    expect(declaration.addressing).toBe("literal");
  });

  it("resolves no credential, and reads the webhook body unparsed", () => {
    const declaration = githubInstallRest.router();

    expect(declaration.routes.map((route) => route.access?.kind)).toEqual([
      "public",
      "public",
      "public",
      "public",
      "public",
    ]);
    expect(
      declaration.routes.filter((route) => route.rawBody).map((route) => route.operation),
    ).toEqual(["receiveGithubWebhook", "receiveGithubWebhookOnLegacyPath"]);
  });
});

describe("given the GitHub installation routes", () => {
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
      // an organization with no Langy access reaches GitHub the same way.
      expect(api.memberChecks).toEqual([{ userId: "user_1", organizationId: "org_1" }]);
    });
  });

  describe("when the instance registered no GitHub App", () => {
    /**
     * The session is an operation this handler calls, not a declared fact the
     * runtime resolves ahead of it, so an instance that cannot start a flow
     * answers without asking who is on the other end.
     */
    /** @scenario App not configured on the instance hides the feature */
    it("answers 503 before it reads a session", async () => {
      const api = mount({ configured: false });

      const response = await api.install("organizationId=org_1");

      expect(response.status).toBe(503);
      expect(api.sessionReads.count).toBe(0);
    });
  });

  describe("when nobody is signed in", () => {
    /** @scenario Starting an installation requires organization management */
    it("answers 401 rather than starting a flow with no owner", async () => {
      const api = mount({ session: null });

      const response = await api.install("organizationId=org_1");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Not authenticated" });
      expect(api.memberChecks).toEqual([]);
    });
  });

  describe("when the caller is not a member of the organization", () => {
    /** @scenario Starting an installation requires organization management */
    it("refuses before the permission is probed, so the answer says nothing about the org", async () => {
      const api = mount({ member: false });

      const response = await api.install("organizationId=org_1");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Not a member of this organization.",
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

      expect(api.webhookEvents).toEqual([]);
    });
  });
});
