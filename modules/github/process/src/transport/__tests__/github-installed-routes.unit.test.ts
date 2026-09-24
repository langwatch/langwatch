/**
 * @vitest-environment node
 * @see modules/github/specs/github-install-routes.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { BearerIdentity, RestHost, UnauthorizedError } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApp } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { memoryStores, resolvedSecrets } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { githubServer } from "../../github.server.ts";
import { githubInstallRest } from "../github-install.rest.ts";

async function installedGithub() {
  return createApp({ role: "api" })
    .withModules([githubServer])
    .withConfig({ github: { appId: undefined, host: undefined, appSlug: undefined } })
    .withStores(memoryStores())
    .withMembers({ redis: null, secrets: resolvedSecrets({}) })
    .provide({
      organization: createApiFixture<OrganizationApi>({}),
      project: createApiFixture<ProjectApi>({}),
      authz: createApiFixture<AuthzApi>({}),
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
});
