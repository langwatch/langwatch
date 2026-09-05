/**
 * `POST /api/auth/cli/virtual-key` — the only way the CLI gets a personal gateway
 * credential, since login itself mints nothing.
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
} from "@langwatch/enterprise-governance-contract";
import type {
  GovernanceCliCaller,
  GovernanceCliRestPorts,
  GovernanceDirectoryPort,
} from "@langwatch/enterprise-governance-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";

const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";
const BEARER = "Bearer lw_at_valid";

describe("given a member whose organization can route somewhere", () => {
  describe("when a second machine asks with its own device label", () => {
    /** @scenario "A second machine asks for a key of its own" */
    it("issues a device-named key rather than re-handing the default", async () => {
      const world = virtualKeyWorld({ defaultAlreadyIssued: true });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/virtual-key",
        { device_label: "Rogerio's MacBook Pro!!" },
        BEARER,
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        secret: "vk-lw-second-secret",
      });
      // The default is untouched — it was never re-issued — and the label is
      // reduced to the charset a key name carries before it lands in one.
      expect(world.issuedLabels).toEqual(["device-rogerio-s-macbook-pro"]);
    });
  });
});

describe("given an organization with no provider the caller can reach", () => {
  describe("when the CLI asks for a personal key", () => {
    /** @scenario "Asking for a personal virtual key with no providers configured is refused" */
    it("answers no_eligible_providers and issues nothing", async () => {
      const world = virtualKeyWorld({ eligibleProviders: false });
      const api = mount(world);

      const response = await api.post("/api/auth/cli/virtual-key", {}, BEARER);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "no_eligible_providers",
      });
      expect(world.issuedLabels).toEqual([]);
    });
  });
});

// --------------------------------------------------------------------------

function virtualKeyWorld(
  options: { defaultAlreadyIssued?: boolean; eligibleProviders?: boolean } = {},
) {
  const world = {
    issuedLabels: [] as string[],
    ports: undefined as unknown as GovernanceCliRestPorts,
  };

  const caller: GovernanceCliCaller = {
    user_id: USER_ID,
    organization_id: ORGANIZATION_ID,
  };

  const directory: GovernanceDirectoryPort = {
    membershipStatus: () => Promise.resolve("active"),
    tryFindPersonProfile: () => Promise.resolve({ name: "Rogerio", email: "rogerio@example.test" }),
    tryFindOrganizationIdByProjectApiKey: () => Promise.resolve(null),
    tryFindMemberIdByEmail: () => Promise.resolve(null),
    tryFindLiveProjectBySlug: () => Promise.resolve(null),
    tryFindLiveProjectByRef: () => Promise.resolve(null),
  };

  world.ports = {
    accessTokens: {
      resolve: (authHeader) => Promise.resolve(authHeader === BEARER ? caller : null),
      revoke: () => Promise.resolve(),
    },
    governance: () =>
      ({
        personalVirtualKeyEnsureDefault: () => {
          if (options.eligibleProviders === false) {
            return Promise.reject(new NoEligibleProvidersError(ORGANIZATION_ID));
          }
          if (options.defaultAlreadyIssued) {
            return Promise.reject(new PersonalVirtualKeyAlreadyExistsError("vk-default"));
          }
          return Promise.resolve({
            virtualKey: { id: "vk-default", displayPrefix: "vk-lw-default" },
            secret: "vk-lw-default-secret",
          });
        },
        personalVirtualKeyIssue: (input: { label: string }) => {
          world.issuedLabels.push(input.label);
          return Promise.resolve({
            virtualKey: { id: "vk-second", displayPrefix: "vk-lw-second" },
            secret: "vk-lw-second-secret",
          });
        },
      }) as never,
    directory: () => directory,
    supportContacts: () => ({ tryResolveSupportContact: () => Promise.resolve(null) }) as never,
    ensurePersonalWorkspace: () =>
      Promise.resolve({
        team: { id: "team-personal" },
        project: { id: "project-personal", slug: "personal", name: "Personal", apiKey: "pkey" },
      }) as never,
    tryFindPersonalWorkspace: () => Promise.resolve(null),
    plans: () => ({ getActivePlan: () => Promise.resolve({ type: "ENTERPRISE" }) }) as never,
    permittedOnOrganization: () => Promise.resolve(true),
    permittedOnProject: () => Promise.resolve(true),
    publicBaseUrl: "https://app.test",
  };

  return world;
}

function mount(world: ReturnType<typeof virtualKeyWorld>) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the governance CLI family resolves its own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      governanceCli: world.ports,
    },
  })) {
    hono.route("/", app);
  }

  const fetchAt = (path: string, init?: RequestInit) =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    post: (path: string, body: unknown, authorization?: string) =>
      fetchAt(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      }),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
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
