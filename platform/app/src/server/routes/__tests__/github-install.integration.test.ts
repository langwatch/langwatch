/**
 * @vitest-environment node
 *
 * Locks the security-critical bits of the GitHub connection's install routes:
 *   /install — session-gated, org-membership + organization:manage checked,
 *              redirects to GitHub with a signed state.
 *   /setup   — verifies the signed state + session rebind before recording the
 *              installation; rejects tampered/expired state and a session change.
 *   /webhook — verifies the X-Hub-Signature-256 HMAC before touching anything;
 *              dispatches installation lifecycle events.
 *
 * The legacy `/github-langy/*` paths are mounted on the same handlers, because
 * they are what the GitHub App's own configuration still points at, and they are
 * exercised here for exactly that reason.
 *
 * Hono is exercised end-to-end through `app.request` with the composed App
 * supplied as request context, exactly as the production API router mounts it.
 *
 * Spec: specs/integrations/github-connection.feature.
 */
import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";

const { TEST_SIGNING_KEY } = vi.hoisted(() => {
  return { TEST_SIGNING_KEY: "x".repeat(64) };
});

const { appConfig } = vi.hoisted(() => ({
  appConfig: {
    appId: "app-123",
    privateKey: "dummy-pem",
    webhookSecret: "whsecret",
    appSlug: "langwatch-langy",
    configured: true,
  },
}));
const getServerAuthSession = vi.fn();
const isOrganizationMember = vi.fn();
const probeOrganizationPermission = vi.fn();
const recordInstallation = vi.fn();
const handleWebhookEvent = vi.fn();
const applyPullRequestEvent = vi.fn();
const auditLog = vi.fn();
const isEnabled = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: (...args: unknown[]) => isEnabled(...args) },
}));
// Partial mock: the route uses only this helper, but other modules in the
// import graph read further rbac exports (Resources etc.).
// The route reads probeOrganizationPermission from the app-layer imperative
// module (it moved off ~/server/api/rbac with ADR-092).
vi.mock(import("~/server/app-layer/permissions/imperative"), async (importOriginal) => ({
  ...(await importOriginal()),
  probeOrganizationPermission: ((...args: unknown[]) =>
    probeOrganizationPermission(...args)) as never,
}));
const githubService = {
  getAppConfig: () => appConfig,
  getWebBase: () => "https://github.com",
  getAppInstallUrl: () => "https://github.com/apps/langwatch-langy/installations/new",
  getInstallStateTtlMs: () => 10 * 60 * 1000,
  registerInstallNonce: vi.fn(async () => false),
  tryConsumeInstallNonce: vi.fn(async () => true),
  signInstallState: (payload: Record<string, unknown>) => signState(payload),
  tryVerifyInstallState: (token: string | null | undefined) => verifyState(token),
  popupResponseHtml: (login: string) => `<p>github-connected @${login}</p>`,
  popupErrorHtml: (message: string) => `<p>github-error ${message}</p>`,
  tryParsePullRequestEvent: (payload: unknown) => parsePullRequestEvent(payload),
  isOrganizationMember: (...args: unknown[]) => isOrganizationMember(...args),
  recordInstallation: (...args: unknown[]) => recordInstallation(...args),
  handleWebhookEvent: (...args: unknown[]) => handleWebhookEvent(...args),
  applyPullRequestEvent: (...args: unknown[]) => applyPullRequestEvent(...args),
} as const;

const routeApp = { github: githubService } as unknown as App;

function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", TEST_SIGNING_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(token: string | null | undefined) {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", TEST_SIGNING_KEY)
    .update(body)
    .digest("base64url");
  if (signature !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (Date.now() - payload.issuedAt > 10 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function parsePullRequestEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, any>;
  const pull = value.pull_request;
  const repository = value.repository;
  if (
    !pull ||
    !repository ||
    pull.head?.repo?.full_name?.toLowerCase() !== repository.full_name?.toLowerCase()
  ) {
    return null;
  }
  return {
    action: value.action,
    installationId: String(value.installation.id),
    repositoryOwner: repository.owner.login,
    repositoryName: repository.name,
    headBranch: pull.head.ref,
    pullRequest: { number: pull.number, state: pull.state },
  };
}

async function request(path: string, init?: RequestInit) {
  const { app } = await import("../github");
  return app.request(path, init, { langwatchApp: routeApp });
}

async function makeState(
  over: Partial<{
    userId: string;
    organizationId: string;
    mode: "popup" | "redirect";
    returnTo: string;
    issuedAt: number;
  }> = {},
) {
  return signState({
    userId: over.userId ?? "u1",
    organizationId: over.organizationId ?? "org1",
    mode: over.mode ?? "popup",
    returnTo: over.returnTo ?? "/settings/integrations#github",
    issuedAt: over.issuedAt ?? Date.now(),
    nonce: "n",
    nonceRegistered: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.configured = true;
  appConfig.webhookSecret = "whsecret";
  getServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
  isOrganizationMember.mockResolvedValue(true);
  probeOrganizationPermission.mockResolvedValue(true);
  recordInstallation.mockResolvedValue({ accountLogin: "acme" });
  applyPullRequestEvent.mockResolvedValue(true);
  isEnabled.mockResolvedValue(true);
});

describe("GET /api/github/install", () => {
  describe("when the user is a member", () => {
    /** @scenario "Starting an installation redirects to GitHub with signed state" */
    it("redirects to GitHub's install page with a signed state", async () => {
      const res = await request(
        "http://localhost/api/github/install?organizationId=org1&mode=redirect",
      );
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("github.com/apps/langwatch-langy/installations/new");
      expect(location).toContain("state=");
    });
  });

  describe("when the user is not a member of the org", () => {
    it("rejects with 403", async () => {
      isOrganizationMember.mockResolvedValue(false);
      const res = await request(
        "http://localhost/api/github/install?organizationId=other",
      );
      expect(res.status).toBe(403);
    });
  });

  describe("when a member lacks organization management", () => {
    /** @scenario "Starting an installation requires organization management" */
    it("rejects with 403", async () => {
      // Connecting the App grants repository access to every project in the
      // organization: membership alone must not be enough on the REST twin
      // either.
      probeOrganizationPermission.mockResolvedValue(false);
      const res = await request(
        "http://localhost/api/github/install?organizationId=org1",
      );
      expect(res.status).toBe(403);
      expect(probeOrganizationPermission).toHaveBeenCalledWith(
        expect.anything(),
        "org1",
        "organization:manage",
      );
    });
  });

  describe("when the instance has no GitHub App configured", () => {
    it("refuses to start an install", async () => {
      appConfig.configured = false;

      const res = await request(
        "http://localhost/api/github/install?organizationId=org1",
      );

      expect(res.status).toBe(503);
    });
  });

  describe("when organizationId is missing", () => {
    it("rejects with 400", async () => {
      const res = await request("http://localhost/api/github/install");
      expect(res.status).toBe(400);
    });
  });

  describe("when the org has no access to Langy", () => {
    /** @scenario "Connecting is not gated by the Langy rollout" */
    it("starts the installation anyway, without evaluating the rollout flag", async () => {
      isEnabled.mockResolvedValue(false);

      const res = await request(
        "http://localhost/api/github/install?organizationId=org1&mode=redirect",
      );

      expect(res.status).toBe(302);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/github/setup", () => {
  describe("when the state + session are valid", () => {
    /** @scenario "Completing an installation records the installation for my org" */
    it("records the installation and returns a postMessage shim (popup)", async () => {
      const state = await makeState({ mode: "popup" });
      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(200);
      expect(recordInstallation).toHaveBeenCalledWith({
        installationId: "555",
        organizationId: "org1",
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "github.connection.install" }),
      );
      const html = await res.text();
      expect(html).toContain("github-connected");
      expect(html).toContain("@acme");
    });

    it("302s back to the safe returnTo (redirect)", async () => {
      const state = await makeState({
        mode: "redirect",
        returnTo: "/settings/integrations#github",
      });
      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/settings/integrations#github");
    });
  });

  describe("when the installation_id is missing", () => {
    it("rejects with 400 without recording", async () => {
      const state = await makeState();
      const res = await request(
        `http://localhost/api/github/setup?state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(400);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the state is expired", () => {
    /** @scenario "Setup callback rejects a tampered or expired state" */
    it("rejects without recording", async () => {
      const stale = await makeState({ issuedAt: Date.now() - 11 * 60 * 1000 });
      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(stale)}`,
      );
      expect(res.status).toBe(400);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the session user does not match the state user", () => {
    it("rejects with 401", async () => {
      const state = await makeState({ userId: "u1" });
      getServerAuthSession.mockResolvedValue({ user: { id: "someone-else" } });
      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(401);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the connect permission was lowered mid-flow", () => {
    it("re-checks organization management and refuses to persist the installation", async () => {
      probeOrganizationPermission.mockResolvedValue(false);
      const state = await makeState({ mode: "popup" });

      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(403);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the installation is already owned by another organization", () => {
    async function mockConflictRejection() {
      const { GithubInstallationConflictError } =
        await import("@langwatch/github-contract");
      recordInstallation.mockRejectedValue(
        new GithubInstallationConflictError({
          installationId: "555",
          existingOrganizationId: "victim-org",
          attemptedOrganizationId: "org1",
        }),
      );
    }

    /** @scenario "An installation cannot be rebound across organizations" */
    it("returns the generic failure and audits the blocked cross-tenant rebind (redirect)", async () => {
      // The attack: a caller with a valid signed state for their OWN org points
      // installation_id at a victim org's installation. recordInstallation now
      // throws the conflict guard; the route must not leak that the id exists
      // (generic message) but must record the attempt for detection.
      await mockConflictRejection();
      const state = await makeState({ mode: "redirect" });

      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      // Generic failure surfaced via the returnTo redirect — no leak.
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("githubError=");
      // The success audit must NOT fire; the rejection audit must.
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "github.connection.install.rejected_cross_tenant",
        }),
      );
      expect(auditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "github.connection.install" }),
      );
    });

    it("returns the generic failure via the popup postMessage shim, not a redirect", async () => {
      await mockConflictRejection();
      const state = await makeState({ mode: "popup" });

      const res = await request(
        `http://localhost/api/github/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      // Popup mode never redirects — the failure comes back as an HTML shim
      // that postMessages the opener, same generic wording as the redirect
      // path (no leak of victim-org / existence either way).
      expect(res.status).toBe(502);
      expect(res.headers.get("location")).toBeNull();
      const body = await res.text();
      expect(body).not.toContain("victim-org");
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "github.connection.install.rejected_cross_tenant",
        }),
      );
      expect(auditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "github.connection.install" }),
      );
    });
  });

  describe("when GitHub calls back on the legacy setup path", () => {
    /** @scenario "The setup callback on the legacy path still records" */
    it("records the installation exactly as the canonical path does", async () => {
      const state = await makeState({ mode: "popup" });

      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(200);
      expect(recordInstallation).toHaveBeenCalledWith({
        installationId: "555",
        organizationId: "org1",
      });
    });
  });
});

describe("POST /api/github/webhook", () => {
  function sign(body: string): string {
    return "sha256=" + createHmac("sha256", "whsecret").update(body).digest("hex");
  }

  describe("when the signature matches", () => {
    /** @scenario "Uninstalling removes the installation" */
    it("dispatches an installation deleted event", async () => {
      const body = JSON.stringify({
        action: "deleted",
        installation: { id: 555 },
      });
      const res = await request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "installation",
          "X-Hub-Signature-256": sign(body),
        },
        body,
      });
      expect(res.status).toBe(200);
      expect(handleWebhookEvent).toHaveBeenCalledWith({
        action: "deleted",
        installationId: "555",
      });
    });
  });

  describe("when the signature does not match", () => {
    /** @scenario "Webhook rejects an unsigned or wrongly signed payload" */
    it("rejects with 401 without dispatching", async () => {
      const body = JSON.stringify({
        action: "deleted",
        installation: { id: 555 },
      });
      const res = await request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "installation",
          "X-Hub-Signature-256": "sha256=deadbeef",
        },
        body,
      });
      expect(res.status).toBe(401);
      expect(handleWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub delivers to the legacy webhook path", () => {
    /** @scenario "The webhook on the legacy path still applies" */
    it("applies the event exactly as the canonical path does", async () => {
      const body = JSON.stringify({
        action: "added",
        installation: { id: 555 },
      });
      const res = await request("http://localhost/api/github-langy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "installation_repositories",
          "X-Hub-Signature-256": sign(body),
        },
        body,
      });
      expect(res.status).toBe(200);
      expect(handleWebhookEvent).toHaveBeenCalledWith({
        action: "added",
        installationId: "555",
      });
    });
  });

  describe("when the event is unrelated", () => {
    it("acks without dispatching", async () => {
      const body = JSON.stringify({ action: "created", zen: "hi" });
      const res = await request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "ping",
          "X-Hub-Signature-256": sign(body),
        },
        body,
      });
      expect(res.status).toBe(200);
      expect(handleWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub announces a pull request", () => {
    /** A `pull_request` delivery, trimmed to the fields the route reads. */
    function pullRequestBody(over: Record<string, unknown> = {}) {
      return JSON.stringify({
        action: "opened",
        installation: { id: 555 },
        repository: {
          name: "widgets",
          full_name: "acme/widgets",
          owner: { login: "acme" },
        },
        pull_request: {
          number: 7,
          html_url: "https://github.com/acme/widgets/pull/7",
          title: "Link sessions to pull requests",
          state: "open",
          draft: false,
          merged_at: null,
          closed_at: null,
          created_at: "2026-08-01T10:00:00.000Z",
          updated_at: "2026-08-01T11:00:00.000Z",
          user: { login: "someone" },
          head: { ref: "feat/linkage", repo: { full_name: "acme/widgets" } },
        },
        ...over,
      });
    }

    async function deliver(body: string, signature?: string) {
      return await request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "pull_request",
          "X-Hub-Signature-256": signature ?? sign(body),
        },
        body,
      });
    }

    it("links the head branch, and touches no installation state", async () => {
      const res = await deliver(pullRequestBody());

      expect(res.status).toBe(200);
      expect(applyPullRequestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "opened",
          installationId: "555",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          headBranch: "feat/linkage",
          pullRequest: expect.objectContaining({ number: 7, state: "open" }),
        }),
      );
      expect(handleWebhookEvent).not.toHaveBeenCalled();
    });

    /** @scenario "Every announcement is acknowledged, applied or not" */
    it("acks a delivery it has nothing to do with", async () => {
      // A pull request opened from a fork: the head lives somewhere else, so
      // linkage has nothing to write for it.
      const forked = pullRequestBody({
        pull_request: {
          ...JSON.parse(pullRequestBody()).pull_request,
          head: {
            ref: "feat/linkage",
            repo: { full_name: "contributor/widgets" },
          },
        },
      });

      const res = await deliver(forked);

      expect(res.status).toBe(200);
      expect(applyPullRequestEvent).not.toHaveBeenCalled();
    });

    it("refuses a wrongly signed announcement before reading it", async () => {
      const res = await deliver(pullRequestBody(), "sha256=deadbeef");

      expect(res.status).toBe(401);
      expect(applyPullRequestEvent).not.toHaveBeenCalled();
    });

    it("acks even when applying the announcement fails", async () => {
      applyPullRequestEvent.mockRejectedValue(new Error("postgres is away"));

      const res = await deliver(pullRequestBody());

      expect(res.status).toBe(200);
    });
  });
});
