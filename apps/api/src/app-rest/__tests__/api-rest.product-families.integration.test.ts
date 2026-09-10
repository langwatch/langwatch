/**
 * The product REST families this process composes for itself, driven through the real
 * Hono app the door registry opens.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { TeamNotFoundError } from "@langwatch/organization-contract";
import type {
  OrganizationRestInviteService,
  OrganizationRestService,
} from "@langwatch/organization-server";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { openTestRestDoors } from "./support/rest-doors.harness.ts";
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

  describe("when this deployment composed an invitation service", () => {
    /**
     * The same service `organization.*` administers over tRPC. What this pins is that the
     * route reaches it and returns what it holds: a listing that answered `[]` would look
     * like a working door and tell an administrator nobody had been invited.
     */
    it("lists the organization's invitations through it", async () => {
      const listInvites = vi.fn(async () => [
        {
          id: "invite-1",
          organizationId: "organization-1",
          email: "newcomer@acme.test",
          role: "MEMBER",
          status: "PENDING",
          inviteCode: "code-1",
          inviteUrl: "https://app.langwatch.test/invite/accept?inviteCode=code-1",
          teamIds: "",
          teamAssignments: null,
          expiration: new Date(0),
          createdAt: new Date(0),
        },
      ]);
      const api = mount({
        organizationManagement: {
          organizations: {} as unknown as OrganizationRestService,
          planType: "ENTERPRISE",
          invites: { listInvites } as unknown as OrganizationRestInviteService,
        },
      });

      const response = await api.fetch("/api/organization/latest/invites");

      expect(response.status).toBe(200);
      expect(listInvites).toHaveBeenCalledWith({ organizationId: "organization-1" });
      await expect(response.text()).resolves.toContain("newcomer@acme.test");
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
  organizationsFail?: boolean;
  organizationManagement?: {
    organizations: OrganizationRestService;
    planType: string;
    /** The invitation half, where this process composed one. */
    invites?: OrganizationRestInviteService;
  };
};

function mount(options: MountOptions) {
  const hono = new Hono();
  const management = options.organizationManagement;
  for (const app of openTestRestDoors({
    services: {
      ...(options.analytics ? { analytics: () => options.analytics! } : {}),
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
              shares: () => ({}) as ShareApi,
              projects: () => ({}) as ProjectApi,
              audit: () => {},
              ...(management.invites
                ? {
                    invites: () => management.invites!,
                    buildInviteAcceptUrl: (inviteCode: string) =>
                      `https://app.langwatch.test/invite/accept?inviteCode=${inviteCode}`,
                  }
                : {}),
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
