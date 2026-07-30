/**
 * @vitest-environment node
 * @integration
 *
 * POST /api/scenario-events/browser-tab — the endpoint the SDK asks before it
 * opens a browser.
 *
 * Covers specs/scenarios/scenario-tab-handoff.feature — the handoff half. The
 * project and its API key are real Prisma rows resolved by the real auth
 * middleware, and tab presence is the real Redis-backed registry. Only the
 * app-layer facade is stubbed, so the broadcast can be observed without
 * standing up the whole dependency graph.
 */
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const { mockBroadcastToTenant } = vi.hoisted(() => ({
  mockBroadcastToTenant: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    broadcast: {
      broadcastToTenant: mockBroadcastToTenant,
      broadcastToTenantRateLimited: vi.fn().mockResolvedValue(undefined),
    },
    usage: {
      checkLimit: vi.fn().mockResolvedValue({ exceeded: false }),
    },
    planProvider: {
      getActivePlan: vi.fn().mockResolvedValue({ name: "free" }),
    },
    usageLimits: {
      notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

// The integration postgres schema does not seed the role bindings the test
// project would need to pass the RBAC grain, so the permission gate is
// replaced with a passthrough. Project resolution from the API key stays real,
// which is what these tests are actually about.
vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    requirePermission:
      () => async (_c: unknown, next: () => Promise<unknown>) => {
        await next();
      },
  };
});

import { app } from "~/app/api/scenario-events/[[...route]]/app";
import {
  isScenarioTabNavigatePayload,
  SCENARIO_TAB_NAVIGATE_EVENT,
} from "~/server/scenarios/browser-tab/scenario-tab-events";
import { scenarioTabRegistry } from "~/server/scenarios/browser-tab/scenario-tab-registry";

const BASE_HOST = "https://test.langwatch.ai";

let apiKey: string;
let projectId: string;
let projectSlug: string;
let otherApiKey: string;
let otherProjectId: string;
let orgId: string;
let teamId: string;
let previousBaseHost: string | undefined;

const registered: Array<{ projectId: string; tabKey: string; tabId: string }> =
  [];

async function registerTab(params: {
  projectId: string;
  tabKey: string;
  tabId?: string;
}): Promise<void> {
  const entry = { tabId: "tab-a", ...params };
  registered.push(entry);
  await scenarioTabRegistry.register(entry);
}

async function handoff(
  body: Record<string, unknown>,
  token: string | null = apiKey,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["X-Auth-Token"] = token;

  return app.request("/api/scenario-events/browser-tab", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  previousBaseHost = process.env.BASE_HOST;
  process.env.BASE_HOST = BASE_HOST;

  const org = await prisma.organization.create({
    data: {
      name: `Tab Handoff Org ${nanoid(6)}`,
      slug: `--tab-handoff-org-${nanoid(6)}`,
    },
  });
  orgId = org.id;

  const team = await prisma.team.create({
    data: {
      name: `Tab Handoff Team ${nanoid(6)}`,
      slug: `--tab-handoff-team-${nanoid(6)}`,
      organizationId: org.id,
    },
  });
  teamId = team.id;

  const created = await prisma.project.create({
    data: {
      ...projectFactory.build({ slug: `--tab-handoff-proj-${nanoid(6)}` }),
      teamId: team.id,
      personalFeatures: {},
    },
  });
  apiKey = created.apiKey;
  projectId = created.id;
  projectSlug = created.slug;

  const other = await prisma.project.create({
    data: {
      ...projectFactory.build({ slug: `--tab-handoff-other-${nanoid(6)}` }),
      teamId: team.id,
      personalFeatures: {},
    },
  });
  otherApiKey = other.apiKey;
  otherProjectId = other.id;
});

afterAll(async () => {
  await Promise.all(
    registered.map((entry) => scenarioTabRegistry.unregister(entry)),
  );

  await cleanupTestRows(prisma, [
    ["project", { id: { in: [projectId, otherProjectId] } }],
    ["team", { id: teamId }],
    ["organization", { id: orgId }],
  ]);

  if (previousBaseHost === void 0) delete process.env.BASE_HOST;
  else process.env.BASE_HOST = previousBaseHost;
});

beforeEach(() => {
  mockBroadcastToTenant.mockClear();
});

describe("POST /api/scenario-events/browser-tab", () => {
  describe("when no tab from that machine is listening", () => {
    /** @scenario "The handoff is not delivered when no tab is listening" */
    /** @scenario "Nothing is parked when no tab was listening" */
    it("reports the handoff as undelivered and broadcasts nothing", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      const res = await handoff({
        tabKey,
        batchRunId: "batch-1",
        scenarioSetId: "checkout-flow",
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ delivered: false });
      expect(mockBroadcastToTenant).not.toHaveBeenCalled();
      // Nothing parked either: a tab that opens later must not be yanked to a
      // run the SDK already showed in its own browser tab.
      await expect(
        scenarioTabRegistry.takePendingNavigate({ projectId, tabKey }),
      ).resolves.toBeNull();
    });
  });

  describe("when a tab from that machine is listening", () => {
    /** @scenario "The handoff is delivered when a tab is listening" */
    it("reports it delivered and broadcasts a navigate payload", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      await registerTab({ projectId, tabKey });

      const res = await handoff({
        tabKey,
        batchRunId: "batch-7",
        scenarioSetId: "checkout-flow",
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        delivered: true,
        url: `${BASE_HOST}/${projectSlug}/simulations/checkout-flow/batch-7`,
      });

      expect(mockBroadcastToTenant).toHaveBeenCalledTimes(1);
      const [broadcastProjectId, payload, eventType] =
        mockBroadcastToTenant.mock.calls[0]!;
      expect(broadcastProjectId).toBe(projectId);
      expect(eventType).toBe("simulation_updated");

      const parsed: unknown = JSON.parse(payload as string);
      expect(isScenarioTabNavigatePayload(parsed)).toBe(true);
      expect(parsed).toEqual({
        event: SCENARIO_TAB_NAVIGATE_EVENT,
        tabKey,
        url: `${BASE_HOST}/${projectSlug}/simulations/checkout-flow/batch-7`,
      });
    });

    /** @scenario "The handoff URL must belong to this LangWatch instance" */
    it("builds the URL itself and ignores any URL the caller sends", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      await registerTab({ projectId, tabKey });

      const res = await handoff({
        tabKey,
        batchRunId: "batch-8",
        scenarioSetId: "checkout-flow",
        url: "https://evil.example/phish",
      });

      expect(res.status).toBe(200);
      const payload = JSON.parse(
        mockBroadcastToTenant.mock.calls[0]![1] as string,
      ) as { url: string };
      expect(payload.url).toBe(
        `${BASE_HOST}/${projectSlug}/simulations/checkout-flow/batch-8`,
      );
    });

    /** @scenario "A handoff sent while the tab was reloading is not lost" */
    it("parks the run so a tab that was reloading can still claim it", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      await registerTab({ projectId, tabKey });

      await handoff({
        tabKey,
        batchRunId: "batch-parked",
        scenarioSetId: "checkout-flow",
      });

      await expect(
        scenarioTabRegistry.takePendingNavigate({ projectId, tabKey }),
      ).resolves.toBe(
        `${BASE_HOST}/${projectSlug}/simulations/checkout-flow/batch-parked`,
      );
    });

    it("falls back to the default set when none is given", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      await registerTab({ projectId, tabKey });

      const res = await handoff({ tabKey, batchRunId: "batch-9" });

      await expect(res.json()).resolves.toMatchObject({
        delivered: true,
        url: `${BASE_HOST}/${projectSlug}/simulations/default/batch-9`,
      });
    });
  });

  describe("scoping", () => {
    /** @scenario "A handoff never crosses projects" */
    it("does not deliver a handoff to another project's tab", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      await registerTab({ projectId, tabKey });
      registered.push({ projectId: otherProjectId, tabKey, tabId: "tab-a" });

      const res = await handoff({ tabKey, batchRunId: "batch-1" }, otherApiKey);

      await expect(res.json()).resolves.toMatchObject({ delivered: false });
      expect(mockBroadcastToTenant).not.toHaveBeenCalled();
    });

    it("does not deliver a handoff meant for a different machine", async () => {
      await registerTab({ projectId, tabKey: `tab-${nanoid(8)}` });

      const res = await handoff({
        tabKey: `tab-${nanoid(8)}`,
        batchRunId: "batch-1",
      });

      await expect(res.json()).resolves.toMatchObject({ delivered: false });
      expect(mockBroadcastToTenant).not.toHaveBeenCalled();
    });
  });

  describe("input handling", () => {
    it("rejects a request without a tab key", async () => {
      const res = await handoff({ batchRunId: "batch-1" });
      expect(res.status).toBe(422);
    });

    it("rejects a request without a batch run id", async () => {
      const res = await handoff({ tabKey: `tab-${nanoid(8)}` });
      expect(res.status).toBe(422);
    });

    /** @scenario "The handoff endpoint refuses an unauthenticated caller" */
    it("rejects an unauthenticated caller", async () => {
      const res = await handoff(
        { tabKey: `tab-${nanoid(8)}`, batchRunId: "batch-1" },
        null,
      );

      expect(res.status).toBe(401);
      expect(mockBroadcastToTenant).not.toHaveBeenCalled();
    });
  });
});
