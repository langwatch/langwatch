/**
 * The ingest leg of `POST /api/scenario-events` that stored objects depend on:
 * @vitest-environment node
 * Spec: specs/features/scenarios/externalize-event-byte-content.feature
 */
import { bodyLimit } from "@langwatch/api/rest";
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logInfo = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: logInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createScenarioEventsRestApp, type InlineMediaExtraction } from "../scenario-event.api";

const PROJECT = { id: "project-1", slug: "project-one" };
const RUN_ID = "run-1";

/** A snapshot carrying one inline image part, the shape the SDK reports. */
function messageSnapshotWithInlineImage() {
  return {
    type: "SCENARIO_MESSAGE_SNAPSHOT",
    timestamp: Date.now(),
    batchRunId: "batch-1",
    scenarioId: "scenario-1",
    scenarioRunId: RUN_ID,
    scenarioSetId: "default",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        ],
      },
    ],
  };
}

beforeEach(() => {
  logInfo.mockClear();
});

describe("given POST /api/scenario-events", () => {
  describe("when the request body exceeds the ingest cap", () => {
    /** @scenario "Event POST rejects bodies larger than 50MB with 413 before extraction" */
    it("answers 413 before any extraction runs", async () => {
      const extract = vi.fn<InlineMediaExtraction>(async ({ event }) => ({
        rewrittenEvent: event,
        refs: [],
      }));
      const api = mount({ extract });

      const response = await api.post("x".repeat(50 * 1024 * 1024 + 1));

      expect(response.status).toBe(413);
      expect(extract).not.toHaveBeenCalled();
    });
  });

  describe("when externalizing the inline bytes fails", () => {
    /** @scenario "Storage put failure aborts the entire event with a 5xx and no partial state" */
    it("refuses the whole event with a 5xx and dispatches nothing", async () => {
      const dispatch = vi.fn();
      const api = mount({
        dispatch,
        extract: async () => {
          throw new Error("storage unavailable");
        },
      });

      const response = await api.post(JSON.stringify(messageSnapshotWithInlineImage()));

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when an event externalizes more than one object", () => {
    /** @scenario "Ingest logs list every stored_objects id extracted for an event" */
    it("logs every stored object id the event created or reused", async () => {
      const api = mount({
        extract: async ({ event }) => ({
          rewrittenEvent: event,
          refs: [{ id: "stored-1" }, { id: "stored-2" }],
        }),
      });

      const response = await api.post(JSON.stringify(messageSnapshotWithInlineImage()));

      expect(response.status).toBe(201);
      const line = logInfo.mock.calls.find(([context]) =>
        Array.isArray((context as { stored_object_ids?: unknown }).stored_object_ids),
      );
      expect(line, "expected an info log carrying stored_object_ids").toBeDefined();
      expect((line![0] as { stored_object_ids: string[] }).stored_object_ids).toEqual([
        "stored-1",
        "stored-2",
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mount(options: { extract: InlineMediaExtraction; dispatch?: ReturnType<typeof vi.fn> }) {
  const dispatch = options.dispatch ?? vi.fn();
  const simulations = { messageSnapshot: dispatch };

  const events = createScenarioEventsRestApp({
    security: passThroughSecurity(),
    simulations: () => simulations as never,
    scenarioTabs: () => ({ resolve: () => undefined }) as never,
    broadcast: () => ({ publish: async () => undefined }) as never,
    extractInlineMedia: options.extract,
    traceUsageGuard: async (_c, next) => {
      await next();
    },
    bodyLimit,
    platformUrl: ({ path }) => `https://app.langwatch.test${path}`,
  });

  const hono = new Hono().route("/", events.hono as never);

  return {
    post: (body: string) =>
      hono.fetch(
        new Request("http://api.test/api/scenario-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      ),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500 body. */
const renderError: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number };
  const status = handled.status ?? handled.httpStatus;
  return c.json({ error: String(error) }, (typeof status === "number" ? status : 500) as never);
};

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const authenticate: () => MiddlewareHandler = () => async (c, next) => {
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
