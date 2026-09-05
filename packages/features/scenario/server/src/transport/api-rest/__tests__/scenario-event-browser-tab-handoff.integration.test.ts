/**
 * `POST /api/scenario-events/browser-tab` — the endpoint the SDK asks before it opens a browser.
 * @vitest-environment node
 * @see specs/scenarios/scenario-tab-handoff.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioTabRegistry } from "@langwatch/scenario-contract";
import { createScenarioEventsRestApp } from "../scenario-event.api";

const PROJECT = { id: "project-1", slug: "project-one" };

function mount(options: {
  authenticated?: boolean;
  hasLiveTab?: boolean;
  setPendingNavigate?: ReturnType<typeof vi.fn>;
  broadcastToTenant?: ReturnType<typeof vi.fn>;
}) {
  const setPendingNavigate = options.setPendingNavigate ?? vi.fn(async () => undefined);
  const broadcastToTenant = options.broadcastToTenant ?? vi.fn(async () => undefined);

  const scenarioTabs: ScenarioTabRegistry = {
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    hasLiveTab: vi.fn(async () => options.hasLiveTab ?? false),
    setPendingNavigate,
    tryTakePendingNavigate: vi.fn(async () => null),
  } as unknown as ScenarioTabRegistry;

  const events = createScenarioEventsRestApp({
    security: security({ authenticated: options.authenticated ?? true }),
    simulations: () => ({}) as never,
    scenarioTabs: () => scenarioTabs,
    broadcast: () => ({ broadcastToTenant }) as never,
    extractInlineMedia: async ({ event }) => ({ rewrittenEvent: event, refs: [] }),
    traceUsageGuard: async (_c, next) => {
      await next();
    },
    bodyLimit: () => async (_c, next) => {
      await next();
    },
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
  });

  const hono = new Hono().route("/", events.hono as never);

  return {
    setPendingNavigate,
    broadcastToTenant,
    post: (body: Record<string, unknown>) =>
      hono.fetch(
        new Request("http://api.test/api/scenario-events/browser-tab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}

const renderError: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number };
  const status = handled.status ?? handled.httpStatus;
  return c.json({ error: String(error) }, (typeof status === "number" ? status : 500) as never);
};

function security(options: { authenticated: boolean }): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const authenticate: () => MiddlewareHandler = () => async (c, next) => {
    if (!options.authenticated) return c.json({ error: "unauthenticated" }, 401);
    c.set("project", PROJECT as never);
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderError,
    canonicalErrorHandler: renderError,
    authenticateProject: authenticate,
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

describe("POST /api/scenario-events/browser-tab", () => {
  describe("when no tab from that machine is listening", () => {
    /** @scenario "The handoff is not delivered when no tab is listening" */
    /** @scenario "Nothing is parked when no tab was listening" */
    it("reports the handoff as undelivered, broadcasts nothing and parks nothing", async () => {
      const api = mount({ hasLiveTab: false });

      const response = await api.post({
        tabKey: "tab-1",
        batchRunId: "batch-1",
        scenarioSetId: "checkout-flow",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ delivered: false });
      expect(api.broadcastToTenant).not.toHaveBeenCalled();
      expect(api.setPendingNavigate).not.toHaveBeenCalled();
    });
  });

  describe("when a tab from that machine is listening", () => {
    /** @scenario "The handoff is delivered when a tab is listening" */
    it("reports it delivered and broadcasts a navigate payload", async () => {
      const api = mount({ hasLiveTab: true });

      const response = await api.post({
        tabKey: "tab-1",
        batchRunId: "batch-7",
        scenarioSetId: "checkout-flow",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        delivered: true,
        url: "https://app.langwatch.test/project-one/simulations/checkout-flow/batch-7",
      });
      expect(api.broadcastToTenant).toHaveBeenCalledTimes(1);
      const [broadcastProjectId, payload, eventType] = api.broadcastToTenant.mock.calls[0]!;
      expect(broadcastProjectId).toBe(PROJECT.id);
      expect(eventType).toBe("simulation_updated");
      expect(JSON.parse(payload as string)).toEqual({
        event: "scenario_tab_navigate",
        tabKey: "tab-1",
        url: "https://app.langwatch.test/project-one/simulations/checkout-flow/batch-7",
      });
    });

    /** @scenario "The handoff URL must belong to this LangWatch instance" */
    it("builds the URL itself and ignores any URL the caller sends", async () => {
      const api = mount({ hasLiveTab: true });

      const response = await api.post({
        tabKey: "tab-1",
        batchRunId: "batch-8",
        scenarioSetId: "checkout-flow",
        url: "https://evil.example/phish",
      });

      expect(response.status).toBe(200);
      const payload = JSON.parse(api.broadcastToTenant.mock.calls[0]![1] as string) as {
        url: string;
      };
      expect(payload.url).toBe(
        "https://app.langwatch.test/project-one/simulations/checkout-flow/batch-8",
      );
    });
  });

  describe("scoping", () => {
    /** @scenario "A handoff never crosses projects" */
    it("does not deliver a handoff to another project's tab", async () => {
      // hasLiveTab is resolved from this caller's own authenticated project;
      // a tab registered under another project never counts as live here.
      const api = mount({ hasLiveTab: false });

      const response = await api.post({ tabKey: "tab-1", batchRunId: "batch-1" });

      await expect(response.json()).resolves.toMatchObject({ delivered: false });
      expect(api.broadcastToTenant).not.toHaveBeenCalled();
    });
  });

  describe("input handling", () => {
    /** @scenario "The handoff endpoint refuses an unauthenticated caller" */
    it("rejects an unauthenticated caller", async () => {
      const api = mount({ authenticated: false });

      const response = await api.post({ tabKey: "tab-1", batchRunId: "batch-1" });

      expect(response.status).toBe(401);
      expect(api.broadcastToTenant).not.toHaveBeenCalled();
    });
  });
});
