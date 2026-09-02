/**
 * `POST /api/ingest/otel/:sourceId` end to end, through the real Hono app this
 * process mounts and the real trace ingestion it composes.
 *
 * Like the project-scoped OTLP receiver's test, this drives the whole path
 * rather than a seam: a REAL OTLP export is posted at the app returned by
 * `createApiProcessRestFeatures`, and what is asserted is that the PRODUCER
 * received a `recordSpan` command carrying that span. The source's bearer
 * resolution, the body read, the JSON parse, the origin stamping, the
 * provenance rewrite and the dedup claim are all the ones that run in
 * production; only the queue the command lands in is stood in for.
 *
 * The three things it pins beyond the golden path:
 *
 *  - the span is tenanted to the HIDDEN GOVERNANCE PROJECT, not to the
 *    source's organization. Governance ingestion shares the trace substrate,
 *    and the internal project is what keeps a customer's own projects free of
 *    it.
 *  - the origin attributes are RECEIVER-AUTHORITATIVE. A payload that supplies
 *    its own `langwatch.origin.kind` has it replaced rather than appended,
 *    because two entries under one key would let the payload forge its origin
 *    and every downstream governance filter reads that key.
 *  - a valid secret pointed at ANOTHER source's path is refused with the same
 *    bare 401 an unknown secret gets, so the answer never confirms that some
 *    other source id exists.
 *
 * And one named absence: the log and metric receivers are NOT MOUNTED on this
 * process, because it folds neither signal. A 404 from a receiver that
 * honestly does not serve them beats a 500 from one that pretends to.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { GovernanceIngestRestPorts } from "@langwatch/enterprise-governance-server";
import { decodeBase64OpenTelemetryId } from "@langwatch/otlp";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";
import { composeApiTraceIngest } from "../../../app/api-trace-ingest.composition";
import type { ApiHandlerManagedCredentials } from "../../../app/api-handler-managed-credential";

const TRACE_ID = "0123456789abcdef0123456789abcdef";
const SPAN_ID = "fedcba9876543210";
const SOURCE_ID = "src-1";
const ORGANIZATION_ID = "org-1";
const GOVERNANCE_PROJECT_ID = "project-governance";
const INGEST_SECRET = "lw_is_thesecret";

describe("given an ingestion source posting its OTLP feed", () => {
  describe("when a collector exports a span on the source's own path", () => {
    it("hands the producer a recordSpan command tenanted to the governance project", async () => {
      const world = ingestWorld();
      const api = mount(world);

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}`, jsonExport());

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        accepted: true,
        events: 1,
      });

      expect(world.commands).toHaveLength(1);
      const [command] = world.commands;
      expect(command?.tenantId).toBe(GOVERNANCE_PROJECT_ID);
      expect(decodeBase64OpenTelemetryId(command?.span.traceId)).toBe(TRACE_ID);
      expect(command?.span.name).toBe("claude-code-turn");

      const attributes = command?.span.attributes ?? [];
      expect(attributes).toContainEqual({
        key: "langwatch.origin.kind",
        value: { stringValue: "ingestion_source" },
      });
      expect(attributes).toContainEqual({
        key: "langwatch.ingestion_source.id",
        value: { stringValue: SOURCE_ID },
      });

      // The receipt is recorded so the Activity Monitor's health view can say
      // when this source was last heard from.
      expect(world.recordedEvents).toEqual([SOURCE_ID]);
    });
  });

  describe("when the payload supplies origin attributes of its own", () => {
    it("replaces them rather than appending, so an origin cannot be forged", async () => {
      const world = ingestWorld();
      const api = mount(world);

      await api.post(
        `/api/ingest/otel/${SOURCE_ID}`,
        jsonExport([
          { key: "langwatch.origin.kind", value: { stringValue: "application" } },
          { key: "langwatch.ingestion_source.id", value: { stringValue: "src-somebody-else" } },
        ]),
      );

      const attributes = world.commands[0]?.span.attributes ?? [];
      const kinds = attributes.filter((a) => a.key === "langwatch.origin.kind");
      expect(kinds).toEqual([
        { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
      ]);
      const ids = attributes.filter((a) => a.key === "langwatch.ingestion_source.id");
      expect(ids).toEqual([
        { key: "langwatch.ingestion_source.id", value: { stringValue: SOURCE_ID } },
      ]);
    });
  });

  describe("when a valid secret is pointed at another source's path", () => {
    it("answers the same bare 401 an unknown secret gets, and enqueues nothing", async () => {
      const world = ingestWorld();
      const api = mount(world);

      const response = await api.post("/api/ingest/otel/src-somebody-else", jsonExport());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
      expect(world.commands).toHaveLength(0);
      expect(world.recordedEvents).toEqual([]);
    });
  });

  describe("when the source type does not emit spans", () => {
    it("names the wrong endpoint rather than acknowledging a feed it cannot read", async () => {
      const world = ingestWorld({ sourceType: "workato" });
      const api = mount(world);

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}`, jsonExport());

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "wrong_endpoint" });
      expect(world.commands).toHaveLength(0);
    });
  });

  describe("when this process folds neither logs nor metrics", () => {
    it("does not serve those receivers at all, rather than serving them over a stub", async () => {
      const world = ingestWorld();
      const api = mount(world);

      const webhook = await api.post(`/api/ingest/webhook/${SOURCE_ID}`, {});
      const logs = await api.post(`/api/ingest/otel/${SOURCE_ID}/v1/logs`, {});
      const metrics = await api.post(`/api/ingest/otel/${SOURCE_ID}/v1/metrics`, {});

      expect(webhook.status).toBe(404);
      expect(logs.status).toBe(404);
      expect(metrics.status).toBe(404);
    });
  });
});

// --------------------------------------------------------------------------

function ingestWorld(options: { sourceType?: string } = {}) {
  const commands: RecordSpanCommandData[] = [];
  const recordedEvents: string[] = [];
  const send = vi.fn(async (data: RecordSpanCommandData) => {
    commands.push(data);
  });

  const ingest = composeApiTraceIngest({
    eventing: recordingEventing(send),
    redis: null,
    credentials: unreachableCredentials(),
    processName: "langwatch-api-test",
  });
  if (!ingest) throw new Error("the trace ingest ports must compose over a command queue");

  const source = {
    id: SOURCE_ID,
    organizationId: ORGANIZATION_ID,
    sourceType: options.sourceType ?? "claude_code",
    teamId: null,
    parserConfig: null,
  };

  const ports: GovernanceIngestRestPorts = {
    governance: () =>
      ({
        tryFindIngestionSourceByIngestSecret: (secret: string) =>
          Promise.resolve(secret === INGEST_SECRET ? source : null),
        ingestionSourceRecordEventReceived: (id: string) => {
          recordedEvents.push(id);
          return Promise.resolve();
        },
      }) as never,
    projects: () =>
      ({
        ensureInternal: () => Promise.resolve({ id: GOVERNANCE_PROJECT_ID }),
      }) as never,
    traceCollection: ingest.otlp.traces!,
    database: () => ({}) as never,
  };

  return { commands, recordedEvents, ports };
}

function mount(world: ReturnType<typeof ingestWorld>) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the ingest receivers resolve their own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      governanceIngest: world.ports,
    },
  })) {
    hono.route("/", app);
  }

  return {
    post: (path: string, body: unknown) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${INGEST_SECRET}`,
          },
          body: JSON.stringify(body),
        }),
      ),
  };
}

/** One resource, one scope, one span — recent enough to pass the age guard. */
function jsonExport(attributes: unknown[] = []) {
  const now = Date.now();
  return {
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [
          {
            scope: { name: "claude-code", version: "1", attributes: [] },
            spans: [
              {
                traceId: Buffer.from(TRACE_ID, "hex").toString("base64"),
                spanId: Buffer.from(SPAN_ID, "hex").toString("base64"),
                parentSpanId: "",
                name: "claude-code-turn",
                kind: 3,
                startTimeUnixNano: String((now - 1000) * 1_000_000),
                endTimeUnixNano: String(now * 1_000_000),
                attributes,
                events: [],
                links: [],
                status: { code: 0, message: "" },
                droppedAttributesCount: 0,
                droppedEventsCount: 0,
                droppedLinksCount: 0,
                flags: 0,
              },
            ],
          },
        ],
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

/**
 * The receivers authenticate with a per-source bearer secret, so the project
 * credential the OTLP door resolves is never reached from this path.
 */
function unreachableCredentials(): ApiHandlerManagedCredentials {
  return {
    authenticate: () => {
      throw new Error("the ingest receivers resolve a source secret, not a project key.");
    },
  } as never;
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
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
