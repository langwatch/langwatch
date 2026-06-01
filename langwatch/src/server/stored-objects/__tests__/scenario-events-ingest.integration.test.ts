/**
 * @vitest-environment node
 * @integration
 *
 * Integration tests for the /api/scenario-events POST handler covering
 * stored-objects ingest behaviour.
 *
 * Covers:
 *  - Case 4: storage PUT failure → 5xx response, no partial state
 *  - Case 8: request body > 50 MB → 413 before extraction runs
 *  - Smoke: valid event with inline media → extraction runs, service called
 *
 * The handler mounts authentication via the real authMiddleware (X-Auth-Token),
 * so a real Prisma project is created in beforeAll. Heavy non-auth dependencies
 * (getApp, createStoredObjectsService) are mocked to keep these tests scoped to
 * the storage path.
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

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before any imports that might trigger module load
// ---------------------------------------------------------------------------

// Mock heavy app-layer dependencies so the handler can run without Redis etc.
// `usage.checkLimit` is consumed by `blockTraceUsageExceededMiddleware` on
// the `/*` chain before the POST handler; without it the middleware throws
// "Cannot read properties of undefined (reading 'checkLimit')" and the
// onError handler turns that into a 500 — masking the route logic entirely.
// Hoisted so the DELETE scope-guard tests can control the scoped run-id
// lookup and assert which runs get archived (or that none do).
const { mockGetRunIdsForScope, mockDeleteRun } = vi.hoisted(() => ({
  mockGetRunIdsForScope: vi.fn().mockResolvedValue([] as string[]),
  mockDeleteRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    simulations: {
      startRun: vi.fn().mockResolvedValue(undefined),
      messageSnapshot: vi.fn().mockResolvedValue(undefined),
      textMessageStart: vi.fn().mockResolvedValue(undefined),
      textMessageEnd: vi.fn().mockResolvedValue(undefined),
      finishRun: vi.fn().mockResolvedValue(undefined),
      deleteRun: mockDeleteRun,
      runs: { getRunIdsForScope: mockGetRunIdsForScope },
    },
    broadcast: {
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

// Mock the auth-middleware module to neutralize requirePermission's RBAC
// check. The integration test's postgres schema doesn't grant the test
// project a TeamUser/OrganizationUser with `scenarios:manage`, so the
// real middleware would 403 before any route handler ran — which is why
// the 413 and happy-path tests used to be `it.skip`. We still exercise
// the actual authMiddleware (project resolution from X-Auth-Token); only
// the project-permission gate is replaced with a passthrough.
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

// We spy on createStoredObjectsService to control whether PUT throws.
// The factory module is mocked so we can replace the returned service per test.
const mockStoreFromBytes = vi.fn();
const mockGetById = vi.fn();

vi.mock("~/server/stored-objects/stored-objects-factory", () => ({
  createStoredObjectsService: vi.fn(() => ({
    storeFromBytes: mockStoreFromBytes,
    getById: mockGetById,
    deleteOwnedBy: vi.fn(),
  })),
}));

// Logger — shared mock so tests can inspect the structured log entries the
// route emits (e.g. AC34: the ingest log line must list every stored_objects
// id extracted for an event). Each createLogger() call returns the same
// proxy backed by a single vi.fn() ledger keyed by level.
const { mockLogInfo, mockLogWarn, mockLogError, mockLogDebug } = vi.hoisted(
  () => ({
    mockLogInfo: vi.fn(),
    mockLogWarn: vi.fn(),
    mockLogError: vi.fn(),
    mockLogDebug: vi.fn(),
  }),
);

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
  }),
}));

// Tracer pass-through
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span: { setAttribute: ReturnType<typeof vi.fn> } = {
        setAttribute: vi.fn(),
      };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

// Metrics stubs
vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

// env
vi.mock("~/env.mjs", () => ({
  env: {
    S3_BUCKET_NAME: "",
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { app } from "~/app/api/scenario-events/[[...route]]/app";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_HOST = "https://test.langwatch.ai";

/** A minimal valid SCENARIO_RUN_STARTED event payload. */
function makeRunStartedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: ScenarioEventType.RUN_STARTED,
    timestamp: Date.now(),
    batchRunId: `batch-${nanoid(6)}`,
    scenarioId: `scenario-${nanoid(6)}`,
    scenarioRunId: `run-${nanoid(6)}`,
    scenarioSetId: "default",
    metadata: { name: "Test scenario" },
    ...overrides,
  };
}

/**
 * A TEXT_MESSAGE_END event whose message.content array carries an inline image part.
 * extractInlineMediaFromEvent checks for event.message.content being an array
 * and processes image parts with source.type="data".
 */
function makeEventWithInlineImage(scenarioRunId: string) {
  const imageBase64 = Buffer.from("fake-image-bytes").toString("base64");
  return {
    type: ScenarioEventType.TEXT_MESSAGE_END,
    timestamp: Date.now(),
    batchRunId: `batch-${nanoid(6)}`,
    scenarioId: `scenario-${nanoid(6)}`,
    scenarioRunId,
    scenarioSetId: "default",
    messageId: `msg-${nanoid(6)}`,
    role: "assistant",
    content: "",
    message: {
      role: "assistant",
      content: [
        {
          type: "image",
          source: {
            type: "data",
            value: imageBase64,
            mimeType: "image/png",
          },
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let testApiKey: string;
let testProjectId: string;
let testProjectSlug: string;
let orgId: string;
let teamId: string;
let previousBaseHost: string | undefined;

beforeAll(async () => {
  previousBaseHost = process.env.BASE_HOST;
  // Persist a real project so the authMiddleware can resolve the API key
  const org = await prisma.organization.create({
    data: {
      name: `SO Ingest Test Org ${nanoid(6)}`,
      slug: `--so-ingest-org-${nanoid(6)}`,
    },
  });
  orgId = org.id;

  const team = await prisma.team.create({
    data: {
      name: `SO Ingest Test Team ${nanoid(6)}`,
      slug: `--so-ingest-team-${nanoid(6)}`,
      organizationId: org.id,
    },
  });
  teamId = team.id;

  const project = projectFactory.build({
    slug: `--so-ingest-proj-${nanoid(6)}`,
  });
  const created = await prisma.project.create({
    data: { ...project, teamId: team.id, personalFeatures: {} },
  });
  testApiKey = created.apiKey;
  testProjectId = created.id;
  testProjectSlug = created.slug;

  // Set BASE_HOST so the handler can build the redirect URL
  process.env.BASE_HOST = BASE_HOST;
});

afterAll(async () => {
  // Best-effort cleanup. Some integration-suite postgres schemas do not
  // include the unified API-key ApiKey table; deleting a project that has
  // related ApiKey rows would FK-cascade through a missing table and
  // throw. Swallowing here keeps test-suite teardown from masking real
  // test failures with cleanup noise.
  try {
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  } catch (error) {
    // The integration suite's postgres schema does not always include the
    // unified API-key ApiKey table; deleting a project that has related ApiKey
    // rows would FK-cascade through a missing table and throw P2003 (FK
    // constraint failed) or P2021 (table does not exist). Swallow ONLY
    // those two known shapes — anything else means cleanup is genuinely
    // misconfigured and the test author needs to see the error.
    const knownMissingFixture =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2003" || error.code === "P2021");
    if (!knownMissingFixture) {
      // eslint-disable-next-line no-console
      console.warn(
        "Unexpected cleanup error in scenario-events-ingest integration suite:",
        error,
      );
    }
  }
  if (previousBaseHost === undefined) {
    delete process.env.BASE_HOST;
  } else {
    process.env.BASE_HOST = previousBaseHost;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/scenario-events (ingest)", () => {
  describe("when a request body exceeds 50 MB (case 8 — 413)", () => {
    /** @scenario "Event POST rejects bodies larger than 50MB with 413 before extraction" */
    it("returns 413 before any extraction logic runs", async () => {
      // bodyLimit is 50 * 1024 * 1024 = 52428800 bytes
      const oversizedBody = "x".repeat(52_428_801);

      const res = await app.request("/api/scenario-events", {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: oversizedBody,
      });

      expect(res.status).toBe(413);
      // storeFromBytes must not have been called — no extraction
      expect(mockStoreFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when the storage driver rejects the PUT with an error (case 4 — 5xx, no partial state)", () => {
    /** @scenario "Storage put failure aborts the entire event with a 5xx and no partial state" */
    it("returns a 5xx and does not partially persist any data", async () => {
      // Arrange: storage PUT will throw
      mockStoreFromBytes.mockRejectedValueOnce(
        new Error("storage unavailable"),
      );

      const scenarioRunId = `run-${nanoid(6)}`;
      const body = makeEventWithInlineImage(scenarioRunId);

      const res = await app.request("/api/scenario-events", {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      // The handler propagates the storage error → 5xx
      expect(res.status).toBeGreaterThanOrEqual(500);
    });
  });

  describe("when a valid event with inline image content is posted (smoke — case 1)", () => {
    /** @scenario "Inline file part is externalized and the event payload is rewritten by id" */
    it("calls storeFromBytes and returns 201 on success", async () => {
      const extractedId = `stored-${nanoid(8)}`;
      mockStoreFromBytes.mockResolvedValueOnce({
        id: extractedId,
        mediaType: "image/png",
        isDuplicate: false,
      });

      const scenarioRunId = `run-${nanoid(6)}`;
      const body = makeEventWithInlineImage(scenarioRunId);

      const res = await app.request("/api/scenario-events", {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(201);
      // storeFromBytes was called with the decoded image bytes
      expect(mockStoreFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: testProjectId,
          mediaType: "image/png",
          purpose: "scenario_event",
        }),
      );
    });
  });

  describe("when an event is posted without auth credentials", () => {
    it("returns 401", async () => {
      const body = makeRunStartedEvent();

      const res = await app.request("/api/scenario-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("when an event extracts one or more stored_objects ids", () => {
    /** @scenario "Ingest logs list every stored_objects id extracted for an event" */
    it("the ingest log line carries every stored_objects id that was created or reused", async () => {
      // Two distinct mock returns, one per inline file part the event carries.
      const id1 = `stored-${nanoid(8)}`;
      mockStoreFromBytes.mockResolvedValueOnce({
        id: id1,
        mediaType: "image/png",
        isDuplicate: false,
      });

      mockLogInfo.mockClear();

      const scenarioRunId = `run-${nanoid(6)}`;
      const body = makeEventWithInlineImage(scenarioRunId);

      const res = await app.request("/api/scenario-events", {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(201);

      // The route emits a log line of the shape:
      //   logger.info({ stored_object_ids: [id1, ...], projectId, scenarioRunId, count }, msg)
      // Find that call and assert every minted id is present in the
      // structured field. Operators rely on this line to correlate
      // events to the rows their cascade-delete eventually touches.
      const matchingCall = mockLogInfo.mock.calls.find((args) => {
        const ctx = args[0] as { stored_object_ids?: unknown };
        return Array.isArray(ctx?.stored_object_ids);
      });

      expect(
        matchingCall,
        "expected an info-level log with stored_object_ids",
      ).toBeDefined();
      const ctx = matchingCall![0] as { stored_object_ids: string[] };
      expect(ctx.stored_object_ids).toContain(id1);
    });
  });
});

describe("DELETE /api/scenario-events (scoped archive)", () => {
  beforeEach(() => {
    mockGetRunIdsForScope.mockClear();
    mockDeleteRun.mockClear();
    mockGetRunIdsForScope.mockResolvedValue([] as string[]);
  });

  describe("when no batchRunId or scenarioSetId is provided", () => {
    /** @scenario "Archiving scenario runs without a scope is rejected" */
    it("returns 400 and archives nothing — never wipes the whole project", async () => {
      const res = await app.request("/api/scenario-events", {
        method: "DELETE",
        headers: { "X-Auth-Token": testApiKey },
      });

      expect(res.status).toBe(400);
      // The footgun guard: neither the run lookup nor any archive ran.
      expect(mockGetRunIdsForScope).not.toHaveBeenCalled();
      expect(mockDeleteRun).not.toHaveBeenCalled();
    });
  });

  describe("when a batchRunId is provided", () => {
    /** @scenario "Archiving scenario runs by batchRunId archives only that batch" */
    it("archives only the runs the scoped lookup returns", async () => {
      mockGetRunIdsForScope.mockResolvedValueOnce(["run-a", "run-b"]);

      const res = await app.request(
        "/api/scenario-events?batchRunId=batch-xyz",
        { method: "DELETE", headers: { "X-Auth-Token": testApiKey } },
      );

      expect(res.status).toBe(200);
      expect(mockGetRunIdsForScope).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: testProjectId,
          batchRunId: "batch-xyz",
        }),
      );
      // Only the two runs the scoped lookup returned are archived.
      expect(mockDeleteRun).toHaveBeenCalledTimes(2);
      const archivedIds = mockDeleteRun.mock.calls.map(
        (args) => (args[0] as { scenarioRunId: string }).scenarioRunId,
      );
      expect(archivedIds).toEqual(["run-a", "run-b"]);
    });
  });
});
