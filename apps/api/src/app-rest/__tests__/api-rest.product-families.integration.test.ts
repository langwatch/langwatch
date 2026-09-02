/**
 * The product REST families this process composes for itself, driven through
 * the real Hono app `createApiProcessRestFeatures` returns.
 *
 * Three families, one test file, because the thing under test is the same in
 * all three: the mount binds the packaged family to a service this process
 * composed, and the wire the family publishes is unchanged by the move. Each
 * gets its golden path and one named failure — the failure being, in every
 * case, the one a customer would otherwise read as an answer.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { TeamNotFoundError } from "@langwatch/organization-contract";
import type { OrganizationRestService } from "@langwatch/organization-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { PromptRestService } from "@langwatch/prompt-server";
import type { ShareService } from "@langwatch/share-contract";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../app-rest.process-features";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

describe("given the analytics timeseries door this process composes", () => {
  describe("when a project credential posts a series", () => {
    it("answers the application's own reading, with the project taken from the credential", async () => {
      const getTimeseries = vi.fn(async () => ({ currentPeriod: [{ x: 1 }], previousPeriod: [] }));
      const api = mount({ analytics: { getTimeseries } as unknown as AnalyticsApp });

      const response = await api.fetch("/api/analytics/timeseries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: 1_767_225_600_000,
          timeZone: "UTC",
          series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        currentPeriod: [{ x: 1 }],
        previousPeriod: [],
      });
      // The body carried no projectId and an ISO start date; the handler takes
      // the project from the credential and hands the application epochs.
      expect(getTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          startDate: 1_767_225_600_000,
          endDate: 1_767_225_600_000,
        }),
      );
    });
  });

  describe("when the body names a period bound the schema cannot read", () => {
    it("refuses rather than charting an unbounded scan", async () => {
      const api = mount({
        analytics: { getTimeseries: vi.fn() } as unknown as AnalyticsApp,
      });

      const response = await api.fetch("/api/analytics/timeseries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: "not-a-date", endDate: 1, timeZone: "UTC", series: [] }),
      });

      // 422, the framework's own shape for a body that parsed as JSON and
      // failed the schema. Pinned because it is the wire, not a detail.
      expect(response.status).toBe(422);
    });
  });

  describe("when this process composed no analytics application", () => {
    it("does not mount the door at all", async () => {
      const api = mount({});

      const response = await api.fetch("/api/analytics/timeseries", { method: "POST" });

      expect(response.status).toBe(404);
    });
  });
});

describe("given the prompt library door this process composes", () => {
  describe("when a project credential lists the prompts", () => {
    it("reads them for the credential's project and the organization the process resolved", async () => {
      const getAllPrompts = vi.fn(async () => []);
      const api = mount({
        prompts: { getAllPrompts } as unknown as PromptRestService,
      });

      const response = await api.fetch("/api/prompts");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([]);
      expect(getAllPrompts).toHaveBeenCalledWith({
        projectId: "project-1",
        organizationId: "organization-1",
        version: "latest",
      });
    });
  });

  describe("when the credential's project belongs to no organization this process can resolve", () => {
    it("answers the wiring failure rather than reading another tenant's prompts", async () => {
      const api = mount({
        prompts: { getAllPrompts: vi.fn() } as unknown as PromptRestService,
        organizationsFail: true,
      });

      const response = await api.fetch("/api/prompts");

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Internal Server Error",
        message: "Organization not found",
      });
    });
  });
});

describe("given the organization management door this process composes", () => {
  describe("when an organization credential on an Enterprise plan reads the settings", () => {
    it("answers from the one organization object the members screen reads", async () => {
      const getSettings = vi.fn(async () => ({
        id: "organization-1",
        name: "Acme",
        slug: "acme",
        supportContact: null,
        presenceEnabled: true,
        traceSharingEnabled: false,
        primaryIntent: null,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3Bucket: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }));
      const api = mount({
        organizationManagement: {
          organizations: { getSettings } as unknown as OrganizationRestService,
          planType: "ENTERPRISE",
        },
      });

      const response = await api.fetch("/api/organization/latest/");

      expect(response.status).toBe(200);
      expect(getSettings).toHaveBeenCalledWith({ organizationId: "organization-1" });
    });
  });

  describe("when this deployment composed no invitation service", () => {
    it("refuses the listing by name rather than reporting that nobody was invited", async () => {
      const api = mount({
        organizationManagement: {
          organizations: {} as unknown as OrganizationRestService,
          planType: "ENTERPRISE",
        },
      });

      const response = await api.fetch("/api/organization/latest/invites");

      expect(response.status).toBe(503);
      // The CODE, not the prose: the boundary replaces a handled error's
      // message with its code on the wire, and the code is what a client
      // presentation registry renders from.
      await expect(response.json()).resolves.toMatchObject({ code: "service_unavailable" });
    });
  });

  describe("when the organization's plan is not Enterprise", () => {
    it("refuses the whole family before it reads anything", async () => {
      const getSettings = vi.fn();
      const api = mount({
        organizationManagement: {
          organizations: { getSettings } as unknown as OrganizationRestService,
          planType: "FREE",
        },
      });

      const response = await api.fetch("/api/organization/latest/");

      expect(response.status).toBe(402);
      expect(getSettings).not.toHaveBeenCalled();
    });
  });
});

type MountOptions = {
  analytics?: AnalyticsApp;
  prompts?: PromptRestService;
  organizationsFail?: boolean;
  organizationManagement?: {
    organizations: OrganizationRestService;
    planType: string;
  };
};

function mount(options: MountOptions) {
  const hono = new Hono();
  const management = options.organizationManagement;
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: {
      ...(options.analytics ? { analytics: () => options.analytics! } : {}),
      ...(options.prompts ? { prompts: () => options.prompts! } : {}),
      organizations: () => ({
        getTeamById: async () => {
          if (options.organizationsFail) {
            throw new TeamNotFoundError("team-1");
          }
          return { id: "team-1", organizationId: "organization-1" } as never;
        },
      }),
      ...(management
        ? {
            organizationManagement: {
              organizations: () => management.organizations,
              permissions: () => ({}) as AuthzService,
              plans: () =>
                ({
                  getActivePlan: async () => ({ type: management.planType }),
                }) as unknown as PlanProvider,
              shares: () => ({}) as ShareService,
              projects: () => ({}) as ProjectService,
              audit: () => {},
            },
          }
        : {}),
    },
    ports: {
      handlerManagedCredential: () => {
        throw new Error("These families authenticate through the framework chain.");
      },
      rateLimit: async () => ({ allowed: true }),
      publicBaseUrl: "https://app.langwatch.test",
    },
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/**
 * Enforcement that authenticates every caller as the same project and the same
 * organization. The families' own access declarations still run; what is faked
 * is only the credential resolution the process would have done.
 */
function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: "organization-1" });
    c.set("apiKeyUserId", "user-1");
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

/**
 * A handled refusal must reach the caller at its own status with its own code;
 * anything else is legible rather than swallowed into a generic 500.
 */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
