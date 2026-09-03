/**
 * Characterisation of the GitHub App installation family through the real Hono
 * app the API process mounts, over fakes at every port.
 *
 * The guard chain is what is pinned, because every link of it is a
 * cross-tenant control. `/install` refuses a non-member BEFORE it probes the
 * permission, so a stranger's answer never depends on anything about the
 * organization; `/setup` re-binds the session to the user the signed state
 * names, so a link opened in somebody else's browser records nothing; and
 * `/webhook` verifies the HMAC over the RAW bytes before any parse, and
 * answers 404 rather than 401 where the install configured no secret.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { createGithubRestApp, type GithubRestPorts } from "@langwatch/github-server";
import { createHmac } from "crypto";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { composeApiGithubRest } from "../github-rest.mount";

const WEBHOOK_SECRET = "webhook-secret";

describe("given the GitHub installation start", () => {
  describe("when the caller is not a member of the organization", () => {
    it("refuses before the permission is probed, so the answer says nothing about the org", async () => {
      const world = githubWorld({ isMember: false });
      const api = mount(world);

      const response = await api.fetch("/api/github/install?organizationId=org_1");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Not a member of this organization.",
      });
      expect(world.permissionProbes).toEqual([]);
    });
  });

  describe("when the caller is a member without organization management", () => {
    it("answers a bare 403", async () => {
      const world = githubWorld({ canManage: false });
      const api = mount(world);

      const response = await api.fetch("/api/github/install?organizationId=org_1");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
      expect(world.permissionProbes).toEqual(["org_1"]);
    });
  });

  describe("when nobody is signed in", () => {
    it("answers 401 rather than starting a flow with no owner", async () => {
      const world = githubWorld({ session: null });
      const api = mount(world);

      const response = await api.fetch("/api/github/install?organizationId=org_1");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Not authenticated" });
    });
  });

  describe("when the instance registered no GitHub App", () => {
    it("answers 503 before it reads a session", async () => {
      const world = githubWorld({ configured: false });
      const api = mount(world);

      const response = await api.fetch("/api/github/install?organizationId=org_1");

      expect(response.status).toBe(503);
      expect(world.sessionReads).toBe(0);
    });
  });

  describe("when a member with organization management starts the flow", () => {
    it("redirects to GitHub carrying a state signed for that person and org", async () => {
      const world = githubWorld();
      const api = mount(world);

      const response = await api.fetch("/api/github/install?organizationId=org_1");

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe("https://github.test/install");
      expect(JSON.parse(location.searchParams.get("state") ?? "{}")).toMatchObject({
        userId: "user_1",
        organizationId: "org_1",
        mode: "redirect",
      });
    });
  });
});

describe("given GitHub's post-install redirect", () => {
  describe("when the browser that returns is signed in as somebody else", () => {
    it("refuses and records no installation, in whichever mode the flow started", async () => {
      const popup = mount(githubWorld({ session: { id: "user_2" } }));
      const popupResponse = await popup.fetch(
        `/api/github/setup?installation_id=42&state=${signedState({ mode: "popup" })}`,
      );
      expect(popupResponse.status).toBe(401);

      const redirectWorld = githubWorld({ session: { id: "user_2" } });
      const redirect = mount(redirectWorld);
      const redirectResponse = await redirect.fetch(
        `/api/github/setup?installation_id=42&state=${signedState()}`,
      );

      // A redirect-mode flow cannot show a status; the refusal rides back as a
      // query parameter on the page the user came from, which is what the
      // settings screen renders.
      expect(redirectResponse.status).toBe(302);
      expect(redirectResponse.headers.get("location")).toContain(
        "githubError=Session+changed+mid-flow",
      );
      expect(redirectWorld.recorded).toEqual([]);
    });
  });

  describe("when the flow completes", () => {
    it("records the installation against the organization the state named", async () => {
      const world = githubWorld();
      const api = mount(world);

      const response = await api.fetch(
        `/api/github/setup?installation_id=42&state=${signedState()}`,
      );

      expect(response.status).toBe(302);
      expect(world.recorded).toEqual([{ installationId: "42", organizationId: "org_1" }]);
      expect(world.audited).toEqual([
        { userId: "user_1", organizationId: "org_1", action: "github.connection.install" },
      ]);
    });
  });
});

describe("given a GitHub webhook delivery", () => {
  describe("when the install configured no webhook secret", () => {
    it("answers 404, so a probe cannot tell the path exists", async () => {
      const world = githubWorld({ webhookSecret: "" });
      const api = mount(world);

      const response = await api.fetch("/api/github/webhook", {
        method: "POST",
        body: "{}",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when the signature does not match the raw bytes", () => {
    it("answers 401 without parsing the body", async () => {
      const world = githubWorld();
      const api = mount(world);

      const response = await api.fetch("/api/github/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef", "x-github-event": "installation" },
        body: JSON.stringify({ action: "created", installation: { id: 42 } }),
      });

      expect(response.status).toBe(401);
      expect(world.webhookEvents).toEqual([]);
    });
  });

  describe("when a signed installation event arrives", () => {
    it("applies it and acks", async () => {
      const world = githubWorld();
      const api = mount(world);
      const body = JSON.stringify({ action: "created", installation: { id: 42 } });

      const response = await api.fetch("/api/github/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": sign(body),
          "x-github-event": "installation",
        },
        body,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true });
      expect(world.webhookEvents).toEqual([{ action: "created", installationId: "42" }]);
    });
  });

  describe("when the delivery arrives on the `github-langy` alias", () => {
    it("is served by the same handler, because the App registrations are not ours to move", async () => {
      const world = githubWorld();
      const api = mount(world);
      const body = JSON.stringify({ action: "deleted", installation: { id: 7 } });

      const response = await api.fetch("/api/github-langy/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body), "x-github-event": "installation" },
        body,
      });

      expect(response.status).toBe(200);
      expect(world.webhookEvents).toEqual([{ action: "deleted", installationId: "7" }]);
    });
  });
});

describe("given a process composing the GitHub door", () => {
  describe("when it resolves no browser session", () => {
    it("composes nothing, rather than a webhook GitHub would never call", () => {
      expect(
        composeApiGithubRest({
          github: {} as never,
          session: undefined,
          authz: {} as never,
          audit: undefined,
        }),
      ).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

/**
 * The signed state, as this world's fake service signs it: plain JSON, so the
 * test can read what the handler put in it. The real signature is the
 * service's own and is exercised by its own tests.
 */
function signedState(options: { mode?: "popup" | "redirect" } = {}): string {
  return encodeURIComponent(
    JSON.stringify({
      userId: "user_1",
      organizationId: "org_1",
      mode: options.mode ?? "redirect",
      returnTo: "/settings/integrations#github",
      issuedAt: Date.now(),
      nonce: "n",
      nonceRegistered: false,
    }),
  );
}

function githubWorld(
  options: {
    configured?: boolean;
    isMember?: boolean;
    canManage?: boolean;
    session?: { id: string } | null;
    webhookSecret?: string;
  } = {},
) {
  const permissionProbes: string[] = [];
  const recorded: { installationId: string; organizationId: string }[] = [];
  const audited: { userId: string; organizationId: string; action: string }[] = [];
  const webhookEvents: { action: string; installationId: string }[] = [];
  const world = {
    permissionProbes,
    recorded,
    audited,
    webhookEvents,
    sessionReads: 0,
    ports: undefined as unknown as GithubRestPorts,
  };

  const service = {
    getAppConfig: () => ({
      configured: options.configured ?? true,
      webhookSecret: "webhookSecret" in options ? options.webhookSecret : WEBHOOK_SECRET,
    }),
    getAppInstallUrl: () => "https://github.test/install",
    getInstallStateTtlMs: () => 600_000,
    registerInstallNonce: async () => false,
    signInstallState: (payload: unknown) => JSON.stringify(payload),
    tryVerifyInstallState: (token: string | null) =>
      token ? (JSON.parse(token) as unknown) : null,
    tryConsumeInstallNonce: async () => true,
    isOrganizationMember: async () => options.isMember ?? true,
    recordInstallation: async (input: { installationId: string; organizationId: string }) => {
      recorded.push(input);
      return { accountLogin: "acme" };
    },
    popupErrorHtml: () => "<html>error</html>",
    popupResponseHtml: () => "<html>ok</html>",
    tryParsePullRequestEvent: () => null,
    applyPullRequestEvent: async () => {},
    handleWebhookEvent: async (input: { action: string; installationId: string }) => {
      webhookEvents.push(input);
    },
  };

  world.ports = {
    github: () => service as never,
    session: async () => {
      world.sessionReads += 1;
      const actor = "session" in options ? options.session : { id: "user_1" };
      return actor ? { user: { id: actor.id } } : null;
    },
    canManageOrganization: async ({ organizationId }) => {
      permissionProbes.push(organizationId);
      return options.canManage ?? true;
    },
    audit: async (entry) => {
      audited.push({
        userId: entry.userId,
        organizationId: entry.organizationId,
        action: entry.action,
      });
    },
  };
  return world;
}

function mount(world: ReturnType<typeof githubWorld>) {
  const hono = new Hono().route(
    "/",
    createGithubRestApp({ security: passThroughSecurity(), ports: world.ports }),
  );
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
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
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
