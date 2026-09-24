/**
 * @vitest-environment node
 * @see modules/github/specs/github-install-routes.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { BearerIdentity, RestHost, UnauthorizedError } from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { GithubApi } from "@langwatch/github-contract";
import { createApp } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { memoryStores, resolvedSecrets } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { githubServer } from "../../github.server.ts";
import { githubInstallRest } from "../github-install.rest.ts";

const SESSION_COOKIE = "session=flow-owner";

async function installedGithub(
  options: {
    signedInAs?: string;
    canManage?: boolean;
  } = {},
) {
  const { signedInAs = "user-1", canManage = true } = options;

  return createApp({ role: "api" })
    .withModules([githubServer])
    .withConfig({ github: { appId: undefined, host: undefined, appSlug: undefined } })
    .withStores(memoryStores())
    .withMembers({
      redis: null,
      secrets: resolvedSecrets({ CREDENTIALS_SECRET: "github-install-state-signing-key" }),
    })
    .provide({
      organization: createApiFixture<OrganizationApi>({ isMember: async () => true }),
      project: createApiFixture<ProjectApi>({}),
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => canManage }),
      auth: createApiFixture<AuthApi>({
        tryVerifyBrowserSession: async ({ headers }) =>
          headers.get("cookie") === SESSION_COOKIE
            ? {
                session: { id: "session-1", expiresAt: new Date(Date.now() + 60_000) },
                user: { id: signedInAs },
              }
            : null,
        tryResolveBrowserSession: async ({ verified }) =>
          verified
            ? {
                user: { id: verified.user.id },
                expires: verified.session.expiresAt.toISOString(),
                sessionId: verified.session.id,
              }
            : null,
      }),
      "audit-log": createApiFixture<AuditLogApi>({}),
      "coding-agent": createApiFixture<CodingAgentApi>({}),
    })
    .boot();
}

function restHost(): RestHost {
  const closed = BearerIdentity.create({ name: "unconfigured", token: undefined });

  return RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: {
        identify: () => {
          throw new UnauthorizedError("Not authenticated");
        },
        authenticate: () => {
          throw new UnauthorizedError("Not authenticated");
        },
        authorize: () => ({ permitted: false, organizationRole: null }),
      },
    },
    bearers: () => closed,
    audit: { record: async () => undefined },
  });
}

/** GitHub's redirect back to `/setup`, carrying a state the flow signed for user-1. */
async function setupAfterSignedFlow(runtime: Awaited<ReturnType<typeof installedGithub>>) {
  const state = runtime.service(GithubApi).signInstallState({
    userId: "user-1",
    organizationId: "org-1",
    mode: "popup",
    returnTo: "/settings/github",
    issuedAt: Date.now(),
    nonce: "flow-nonce",
    nonceRegistered: false,
  });
  const host = restHost();
  host.mount(githubInstallRest.router(), () => runtime.module(githubServer).provided);

  const response = await host.app.request(
    new Request(
      `http://api.test/api/github/setup?installation_id=1&state=${encodeURIComponent(state)}`,
      { headers: { cookie: SESSION_COOKIE } },
    ),
  );

  return { status: response.status, body: await response.text() };
}

describe("given the github module installed over memory stores", () => {
  describe("when GitHub calls the Setup URL without a signed state", () => {
    /** @scenario "the installed module answers the GitHub App Setup URL" */
    it("answers 400 from the installed implementation", async () => {
      const runtime = await installedGithub();

      try {
        const host = restHost();
        const provided = runtime.module(githubServer).provided;
        host.mount(githubInstallRest.router(), () => provided);

        const response = await host.app.request(
          new Request("http://api.test/api/github/setup?installation_id=1"),
        );

        expect({ status: response.status, body: await response.text() }).toEqual({
          status: 400,
          body: expect.stringContaining("Invalid state or missing installation"),
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when a different person is signed in on the Setup URL's request", () => {
    /** @scenario "the Setup URL refuses a signed state brought back by someone else" */
    it("answers 401 from the session the auth module resolves", async () => {
      const runtime = await installedGithub({ signedInAs: "user-2" });

      try {
        expect(await setupAfterSignedFlow(runtime)).toEqual({
          status: 401,
          body: expect.stringContaining("Session changed mid-flow"),
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the person who started the flow can no longer manage the organization", () => {
    /** @scenario "the Setup URL refuses a person who can no longer manage the organization" */
    it("answers 403 after resolving their session", async () => {
      const runtime = await installedGithub({ canManage: false });

      try {
        expect(await setupAfterSignedFlow(runtime)).toEqual({
          status: 403,
          body: expect.stringContaining("Forbidden"),
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
