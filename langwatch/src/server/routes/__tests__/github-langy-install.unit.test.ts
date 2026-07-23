/**
 * @vitest-environment node
 *
 * Locks the security-critical bits of the GitHub App install routes:
 *   /install — session-gated, org-membership + langy:manage checked, redirects
 *              to GitHub with a signed state.
 *   /setup   — verifies the signed state + session rebind before recording the
 *              installation; rejects tampered/expired state and a session change.
 *   /webhook — verifies the X-Hub-Signature-256 HMAC before touching anything;
 *              dispatches installation lifecycle events.
 *
 * getApp() is mocked at the app-layer boundary; Hono is exercised end-to-end
 * through `app.request`.
 */
import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SIGNING_KEY = "x".repeat(64);
process.env.CREDENTIALS_SECRET = TEST_SIGNING_KEY;
process.env.GITHUB_LANGY_APP_ID = "app-123";
process.env.GITHUB_LANGY_APP_SLUG = "langwatch-langy";
process.env.GITHUB_LANGY_PRIVATE_KEY = "dummy-pem";
process.env.GITHUB_LANGY_WEBHOOK_SECRET = "whsecret";

const getServerAuthSession = vi.fn();
const isOrganizationMember = vi.fn();
const hasOrganizationPermission = vi.fn();
const recordInstallation = vi.fn();
const handleWebhookEvent = vi.fn();
const auditLog = vi.fn();
const isEnabled = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/app-layer", () => ({
  getApp: () => ({
    langy: {
      githubInstallations: {
        isOrganizationMember: (...a: unknown[]) => isOrganizationMember(...a),
        recordInstallation: (...a: unknown[]) => recordInstallation(...a),
        handleWebhookEvent: (...a: unknown[]) => handleWebhookEvent(...a),
      },
    },
  }),
}));
vi.mock("~/server/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: (...args: unknown[]) => isEnabled(...args) },
}));
// Partial mock: the route uses only this helper, but other modules in the
// import graph read further rbac exports (Resources etc.).
vi.mock(import("~/server/api/rbac"), async (importOriginal) => ({
  ...(await importOriginal()),
  hasOrganizationPermission: ((...args: unknown[]) =>
    hasOrganizationPermission(...args)) as never,
}));
vi.mock("~/server/db", () => ({ prisma: {} }));

async function request(path: string, init?: RequestInit) {
  const { app } = await import("../github-langy");
  return app.request(path, init);
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
  const { signGithubOauthState } = await import(
    "~/server/app-layer/langy/githubOauthState"
  );
  return signGithubOauthState(
    {
      userId: over.userId ?? "u1",
      organizationId: over.organizationId ?? "org1",
      mode: over.mode ?? "popup",
      returnTo: over.returnTo ?? "/settings/integrations#github",
      issuedAt: over.issuedAt ?? Date.now(),
      nonce: "n",
      nonceRegistered: false,
    },
    TEST_SIGNING_KEY,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
  isOrganizationMember.mockResolvedValue(true);
  hasOrganizationPermission.mockResolvedValue(true);
  recordInstallation.mockResolvedValue({ accountLogin: "acme" });
  isEnabled.mockResolvedValue(true);
});

describe("GET /api/github-langy/install", () => {
  describe("when the user is a member", () => {
    it("redirects to GitHub's install page with a signed state", async () => {
      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=org1&mode=redirect",
      );
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain(
        "github.com/apps/langwatch-langy/installations/new",
      );
      expect(location).toContain("state=");
    });
  });

  describe("when the user is not a member of the org", () => {
    it("rejects with 403", async () => {
      isOrganizationMember.mockResolvedValue(false);
      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=other",
      );
      expect(res.status).toBe(403);
    });
  });

  describe("when a member lacks langy:manage", () => {
    it("rejects with 403 without ever evaluating the flag", async () => {
      // Connecting the App grants Langy repository access for every project
      // underneath — membership alone must not be enough on the REST twin
      // either.
      hasOrganizationPermission.mockResolvedValue(false);
      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=org1",
      );
      expect(res.status).toBe(403);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when organizationId is missing", () => {
    it("rejects with 400", async () => {
      const res = await request(
        "http://localhost/api/github-langy/install",
      );
      expect(res.status).toBe(400);
    });
  });

  describe("when the rollout is enabled for the org", () => {
    it("evaluates the flag against the organization and allows the install", async () => {
      isEnabled.mockResolvedValue(true);

      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=org1&mode=redirect",
      );

      expect(res.status).toBe(302);
      // The org scope must reach the flag, not just the user's distinctId.
      expect(isEnabled).toHaveBeenCalledWith(
        "release_langy_enabled",
        expect.objectContaining({ organizationId: "org1" }),
      );
    });
  });

  describe("when a member's org has the rollout disabled", () => {
    it("denies with 404", async () => {
      isEnabled.mockResolvedValue(false);

      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=org1",
      );

      expect(res.status).toBe(404);
    });
  });

  // Membership is proven before the org-scoped flag, so a non-member's response
  // must not depend on that org's rollout state — otherwise it's a cross-tenant
  // probe (FORBIDDEN when enabled vs NOT_FOUND when disabled).
  describe("when a non-member probes an org with the rollout enabled", () => {
    it("returns 403 without ever evaluating the flag", async () => {
      isOrganizationMember.mockResolvedValue(false);
      isEnabled.mockResolvedValue(true);

      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=victim-org",
      );

      expect(res.status).toBe(403);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when a non-member probes an org with the rollout disabled", () => {
    it("returns the same 403 (response independent of the org's flag)", async () => {
      isOrganizationMember.mockResolvedValue(false);
      isEnabled.mockResolvedValue(false);

      const res = await request(
        "http://localhost/api/github-langy/install?organizationId=victim-org",
      );

      expect(res.status).toBe(403);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/github-langy/setup", () => {
  describe("when the state + session are valid", () => {
    it("records the installation and returns a postMessage shim (popup)", async () => {
      const state = await makeState({ mode: "popup" });
      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(200);
      expect(recordInstallation).toHaveBeenCalledWith({
        installationId: "555",
        organizationId: "org1",
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "langy.github.install" }),
      );
      const html = await res.text();
      expect(html).toContain("langy-github-connected");
      expect(html).toContain("@acme");
    });

    it("302s back to the safe returnTo (redirect)", async () => {
      const state = await makeState({
        mode: "redirect",
        returnTo: "/settings/integrations#github",
      });
      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/settings/integrations#github");
    });
  });

  describe("when the installation_id is missing", () => {
    it("rejects with 400 without recording", async () => {
      const state = await makeState();
      const res = await request(
        `http://localhost/api/github-langy/setup?state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(400);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the state is expired", () => {
    it("rejects without recording", async () => {
      const stale = await makeState({ issuedAt: Date.now() - 11 * 60 * 1000 });
      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(stale)}`,
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
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(401);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the connect permission was lowered mid-flow", () => {
    it("re-checks langy:manage and refuses to persist the installation", async () => {
      hasOrganizationPermission.mockResolvedValue(false);
      const state = await makeState({ mode: "popup" });

      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(403);
      expect(recordInstallation).not.toHaveBeenCalled();
    });
  });

  describe("when the installation is already owned by another organization", () => {
    it("returns the generic failure and audits the blocked cross-tenant rebind", async () => {
      // The attack: a caller with a valid signed state for their OWN org points
      // installation_id at a victim org's installation. recordInstallation now
      // throws the conflict guard; the route must not leak that the id exists
      // (generic message) but must record the attempt for detection.
      const { LangyGithubInstallationConflictError } = await import(
        "~/server/app-layer/langy/langy-github-installations.service"
      );
      recordInstallation.mockRejectedValue(
        new LangyGithubInstallationConflictError("555", "victim-org", "org1"),
      );
      const state = await makeState({ mode: "redirect" });

      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      // Generic failure surfaced via the returnTo redirect — no leak.
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("githubError=");
      // The success audit must NOT fire; the rejection audit must.
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "langy.github.install.rejected_cross_tenant",
        }),
      );
      expect(auditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "langy.github.install" }),
      );
    });
  });

  describe("when Langy access was revoked after the install began", () => {
    it("re-checks the gate and refuses to persist the installation", async () => {
      // Install started while allowed; the rollout is now off for this
      // caller. The kill switch must be immediate on the persisting
      // path, so setup denies before recordInstallation runs.
      isEnabled.mockResolvedValue(false);
      const state = await makeState({ mode: "popup" });

      const res = await request(
        `http://localhost/api/github-langy/setup?installation_id=555&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(404);
      expect(recordInstallation).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/github-langy/webhook", () => {
  function sign(body: string): string {
    return "sha256=" + createHmac("sha256", "whsecret").update(body).digest("hex");
  }

  describe("when the signature matches", () => {
    it("dispatches an installation deleted event", async () => {
      const body = JSON.stringify({
        action: "deleted",
        installation: { id: 555 },
      });
      const res = await request("http://localhost/api/github-langy/webhook", {
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
    it("rejects with 401 without dispatching", async () => {
      const body = JSON.stringify({
        action: "deleted",
        installation: { id: 555 },
      });
      const res = await request("http://localhost/api/github-langy/webhook", {
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

  describe("when the event is unrelated", () => {
    it("acks without dispatching", async () => {
      const body = JSON.stringify({ action: "created", zen: "hi" });
      const res = await request("http://localhost/api/github-langy/webhook", {
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
});
