/**
 * The three trace REST doors this process mounts, driven through the real Hono
 * app `createApiProcessRestFeatures` builds.
 *
 * Nothing between the wire and the port is stubbed: the access declarations,
 * the body schemas built from the deployment's own filter vocabulary, the
 * projection compiler, the evaluation enricher, the two formatters and the
 * deprecation headers are all the ones that run in production. What is stood
 * in for is only what a test cannot hold — the trace read itself, the share
 * ledger, the credential resolution and the queue a collector span is enqueued
 * into.
 *
 * Each family gets its golden path and one named failure, and the failures are
 * chosen for what they would cost if they regressed:
 *
 *   - an unknown `select` path must be a VALIDATION failure naming the path,
 *     not an anonymous 400: a caller with twenty columns needs to know which
 *     one is wrong;
 *   - the deprecated read must answer its own bare `{ message }` 401 rather
 *     than the framework envelope, because a deployed SDK parses it;
 *   - the collector must hand the producer a `recordSpan` command for a real
 *     legacy payload, and must answer 400 rather than enqueueing anything when
 *     the payload names no trace at all.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { ShareService } from "@langwatch/share-contract";
import type { RecordSpanCommandData, Trace } from "@langwatch/trace-contract";
import type { TraceApp } from "@langwatch/trace-server";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";
import type { ApiHandlerManagedCredentials } from "../../../app/api-handler-managed-credential";
import { composeApiTraceIngest } from "../../../app/api-trace-ingest.composition";
import type { ApiTraceReadStackPort } from "../../../app/api-trpc-collaborators.trace-group.composition";

const PROJECT = {
  id: "project-1",
  slug: "acme",
  teamId: "team-1",
  name: "Acme",
  organizationId: "org-1",
};

const TRACE_ID = "trace_0123456789abcdef";

describe("given the v1 trace reads over this process's read stack", () => {
  describe("when a project credential searches", () => {
    it("streams the page, enriched and deep-linked, with the project taken from the credential", async () => {
      const getAllTracesForProject = vi.fn(async () => ({
        groups: [[traceRow()]],
        traceChecks: {},
        totalHits: 1,
        scrollId: "next-page",
      }));
      const { api } = mount({ read: { getAllTracesForProject } });

      const response = await api.fetch("/api/traces/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: 1_767_225_600_000,
          filters: {},
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        traces: Array<{ trace_id: string; platformUrl: string }>;
        pagination: { totalHits: number; scrollId: string };
      };
      expect(body.pagination).toEqual({ totalHits: 1, scrollId: "next-page" });
      expect(body.traces).toHaveLength(1);
      expect(body.traces[0]?.trace_id).toBe(TRACE_ID);
      // The deep link is built from the deployment's own origin and the
      // project's slug, which the credential — not the body — supplied.
      expect(body.traces[0]?.platformUrl).toBe(
        `https://app.langwatch.test/acme/traces/${TRACE_ID}`,
      );

      // The ISO start date reached the read as epoch milliseconds, and the
      // download-mode options the search has always passed came with it.
      expect(getAllTracesForProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT.id, startDate: 1_767_225_600_000 }),
        expect.anything(),
        expect.objectContaining({ downloadMode: true, dateField: "occurred" }),
      );
    });
  });

  describe("when the body selects a column that does not exist", () => {
    it("names the offending path rather than answering an anonymous refusal", async () => {
      const getAllTracesForProject = vi.fn();
      const { api } = mount({ read: { getAllTracesForProject } });

      const response = await api.fetch("/api/traces/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startDate: 1,
          endDate: 2,
          filters: {},
          select: ["trace_id", "metadata.user_id", "not_a_column"],
        }),
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("validation_error");
      // The read is never reached: a projection that cannot compile would
      // otherwise scan the window before failing.
      expect(getAllTracesForProject).not.toHaveBeenCalled();
    });
  });

  describe("when the trace the caller asked for is gone", () => {
    it("answers the sentence this endpoint has always answered", async () => {
      const { api } = mount({ read: { getById: vi.fn(async () => undefined) } });

      const response = await api.fetch(`/api/traces/${TRACE_ID}`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ message: "Trace not found." });
    });
  });

  describe("when the process composed no coding-agent session store", () => {
    it("does not register the transcript route at all", async () => {
      const { api } = mount({});

      const response = await api.fetch(`/api/traces/${TRACE_ID}/transcript`);

      // 404 from a door that honestly does not serve it, rather than an empty
      // transcript that reads as "this agent did nothing".
      expect(response.status).toBe(404);
    });
  });
});

describe("given the deprecated trace doors", () => {
  describe("when a project credential reads one trace", () => {
    it("answers the trace with its evaluations, stamped with the successor link", async () => {
      const readTrace = vi.fn(async () => traceRow());
      const readEvaluations = vi.fn(async () => ({ [TRACE_ID]: [{ evaluator_id: "e1" }] }));
      const { api } = mount({ app: { readTrace, readEvaluations } });

      const response = await api.fetch(`/api/trace/${TRACE_ID}`, {
        headers: { "x-auth-token": "token" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Link")).toBe(
        `</api/traces/${TRACE_ID}?format=json>; rel="successor-version"`,
      );
      await expect(response.json()).resolves.toMatchObject({
        trace_id: TRACE_ID,
        evaluations: [{ evaluator_id: "e1" }],
      });
    });
  });

  describe("when the request carries no credential", () => {
    it("answers the bare sentence a deployed SDK parses, and reads nothing", async () => {
      const readTrace = vi.fn();
      const { api } = mount({
        app: { readTrace },
        credential: () =>
          Promise.resolve({ ok: false as const, status: 401 as const, body: { message: "no" } }),
      });

      const response = await api.fetch(`/api/trace/${TRACE_ID}`);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "no" });
      expect(readTrace).not.toHaveBeenCalled();
    });
  });

  describe("when a caller mints a public link for a trace", () => {
    it("writes it to the one share ledger the product reads", async () => {
      const createShare = vi.fn(async () => ({ id: "share-1" }));
      const { api } = mount({ share: { createShare } });

      const response = await api.fetch(`/api/trace/${TRACE_ID}/share`, {
        method: "POST",
        headers: { "x-auth-token": "token" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "success",
        path: "/share/share-1",
      });
      expect(createShare).toHaveBeenCalledWith({
        projectId: PROJECT.id,
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
    });
  });
});

describe("given the SDK collector over this process's own producer", () => {
  describe("when an SDK posts a legacy collector payload", () => {
    it("hands the producer a recordSpan command for that span", async () => {
      const { api, commands } = mount({});

      const response = await api.fetch("/api/collector", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify(collectorPayload()),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        message: "Trace received successfully.",
        partialSuccess: { rejectedSpans: 0, rejectedEvaluations: 0 },
      });

      expect(commands).toHaveLength(1);
      expect(commands[0]?.tenantId).toBe(PROJECT.id);
      expect(commands[0]?.span.name).toBe("llm-call");
    });
  });

  describe("when the payload names no trace at all", () => {
    it("refuses it rather than enqueueing a span nothing can be joined to", async () => {
      const { api, commands } = mount({});

      const payload = collectorPayload();
      delete (payload as { trace_id?: string }).trace_id;
      for (const span of payload.spans) delete (span as { trace_id?: string }).trace_id;

      const response = await api.fetch("/api/collector", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ message: "Trace ID not defined" });
      expect(commands).toHaveLength(0);
    });
  });

  describe("when the request carries no usable credential", () => {
    it("answers the collector's own sentence, which every SDK's copy quotes", async () => {
      const { api, commands } = mount({
        credential: () =>
          Promise.resolve({ ok: false as const, status: 401 as const, body: { message: "no" } }),
      });

      const response = await api.fetch("/api/collector", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(collectorPayload()),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized",
        message: "Invalid credentials",
      });
      expect(commands).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------

type MountOverrides = {
  read?: Partial<Record<string, unknown>>;
  app?: Partial<Record<string, unknown>>;
  share?: Partial<Record<string, unknown>>;
  credential?: ApiHandlerManagedCredentials["authenticate"];
};

/** The process's REST door, over a producer that records rather than enqueues. */
function mount(overrides: MountOverrides) {
  const commands: RecordSpanCommandData[] = [];
  const ingest = composeApiTraceIngest({
    eventing: recordingEventing(async (data) => {
      commands.push(data);
    }),
    redis: null,
    credentials: credentialsStub(overrides.credential),
    processName: "langwatch-api-test",
  });
  if (!ingest) throw new Error("the ingest ports must compose over a command queue");

  const reads = readStackStub(overrides.read ?? {});
  const traceApp = {
    readTrace: async () => undefined,
    readEvaluations: async () => ({}),
    listTraces: async () => ({ groups: [], traceChecks: {}, totalHits: 0 }),
    readThreadTraces: async () => [],
    ...(overrides.app ?? {}),
  } as unknown as TraceApp;
  const shares = {
    createShare: async () => ({ id: "share-1" }),
    unshare: async () => undefined,
    ...(overrides.share ?? {}),
  } as unknown as ShareService;

  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: {
      traceReads: {
        reads,
        platformUrl: ({ projectSlug, path }) =>
          `https://app.langwatch.test/${projectSlug}${path}`,
      },
      traceLegacy: {
        traces: () => traceApp,
        shares: () => shares,
        reads,
        credential: (input) =>
          credentialsStub(overrides.credential).authenticate(input) as never,
      },
    },
    ports: {
      handlerManagedCredential: (input) =>
        credentialsStub(overrides.credential).authenticate(input) as never,
      rateLimit: async () => ({ allowed: true }),
      collector: {
        credential: ingest.collectorCredential,
        ingestSpan: ingest.ingestSpan,
        deriveEvaluatorId: (name) => `customeval_${name}`,
      },
    },
  })) {
    hono.route("/", app);
  }

  return {
    commands,
    api: {
      fetch: (path: string, init?: RequestInit) =>
        hono.fetch(new Request(`http://api.test${path}`, init)),
    },
  };
}

/** The read stack, holding only what these three families call. */
function readStackStub(read: Partial<Record<string, unknown>>): ApiTraceReadStackPort {
  const readers = {
    read: {
      getAllTracesForProject: async () => ({ groups: [], traceChecks: {}, totalHits: 0 }),
      getById: async () => traceRow(),
      getEvaluationsMultiple: async () => ({}),
      ...read,
    },
  };
  return {
    readers: () => readers,
    // The API key's redactions. Costs visible, captured content hidden — which
    // is what a project with no public-visibility rule resolves to.
    getApiKeyProtections: async () => ({
      canSeeCosts: true,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
    }),
  } as unknown as ApiTraceReadStackPort;
}

/** One stored trace, as the reads answer with it. */
function traceRow(): Trace {
  return {
    trace_id: TRACE_ID,
    project_id: PROJECT.id,
    metadata: {},
    timestamps: { started_at: Date.now(), inserted_at: Date.now(), updated_at: Date.now() },
    spans: [],
  } as unknown as Trace;
}

/** One legacy collector body: the shape an SDK has always posted. */
function collectorPayload() {
  const now = Date.now();
  return {
    trace_id: TRACE_ID,
    metadata: { user_id: "user-1" },
    spans: [
      {
        span_id: "span-1",
        trace_id: TRACE_ID,
        type: "llm" as const,
        name: "llm-call",
        input: { type: "text" as const, value: "hello" },
        output: { type: "text" as const, value: "world" },
        timestamps: { started_at: now - 1000, finished_at: now },
      },
    ],
  };
}

/** A runtime holding one pipeline whose `recordSpan` records what it is sent. */
function recordingEventing(send: (data: RecordSpanCommandData) => Promise<void>) {
  const registration = { commands: { recordSpan: { send } } };
  return {
    getPipeline: () => {
      throw new Error("trace_processing has not been registered yet");
    },
    register: () => registration,
  } as never;
}

/** The credential this process would have resolved, or the given refusal. */
function credentialsStub(
  authenticate?: ApiHandlerManagedCredentials["authenticate"],
): ApiHandlerManagedCredentials {
  return {
    authenticate:
      authenticate ??
      (() =>
        Promise.resolve({
          ok: true as const,
          project: { ...PROJECT, isPersonal: false, ownerUserId: null },
          resolved: {
            type: "apiKey" as const,
            apiKeyId: "key-1",
            userId: null,
            organizationId: PROJECT.organizationId,
            ingestSourceType: null,
            ingestionTemplateId: null,
            project: { ...PROJECT, isPersonal: false, ownerUserId: null },
          },
          markUsed: () => void 0,
        })),
  } as never;
}

/**
 * Enforcement that authenticates every framework-chain caller as the same
 * project. The families' own access declarations still run; what is faked is
 * only the credential resolution the process would have done.
 */
function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", PROJECT);
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
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
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

/**
 * A handled refusal must reach the caller at its own status with its own code;
 * anything else is legible rather than swallowed into a generic 500.
 */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as {
    httpStatus?: number;
    status?: number;
    code?: string;
    message?: string;
  };
  const status = handled.httpStatus ?? handled.status;
  if (typeof status === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      status as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
