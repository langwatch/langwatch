/**
 * `POST /api/otel/v1/traces` end to end, through the real Hono app this
 * process mounts and the real ingestion service it composes.
 *
 * This is the deployment's critical path, so the test drives the whole of it
 * rather than a seam: a REAL OTLP export — once as protobuf, once as JSON — is
 * posted at the app returned by `createApiProcessRestFeatures`, and what is
 * asserted is that the PRODUCER received a `recordSpan` command carrying that
 * span. Nothing between the wire and the command is stubbed: the credential
 * mapping, the body read, the protobuf and JSON parsers, the receiver's
 * provenance rewrite, the dedup claim and the span validation are all the ones
 * that run in production. Only the two things this process cannot hold in a
 * test are stood in for — the credential resolution and the queue the command
 * is enqueued into.
 *
 * The four things it pins, and why each is worth a test:
 *
 *   - a span posted as PROTOBUF reaches the producer. Most production
 *     collectors emit protobuf for size, so a JSON-only test would pass while
 *     the fleet silently failed.
 *   - a span posted as JSON reaches the producer with the SAME trace id. The
 *     two encodings carry the id differently (bytes against base64), and a
 *     receiver that agreed on only one of them splits one customer's trace in
 *     two.
 *   - `langwatch.api_key.id` is rewritten from the CREDENTIAL on every
 *     request, even when the payload set it to something else. The redaction
 *     deny-list exempts that attribute name, and that exemption is only sound
 *     while the value cannot come from the payload.
 *   - the signals this process composed no collection for are NOT MOUNTED. A
 *     404 from a receiver that honestly does not serve logs is an exporter's
 *     problem to see; a 500 from one that pretends to is ours.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { decodeBase64OpenTelemetryId } from "@langwatch/otlp";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../../app-rest/app-rest.process-features";
import type { ApiHandlerManagedCredentials } from "../api-handler-managed-credential";
import { composeApiTraceIngest } from "../api-trace-ingest.composition";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

const TRACE_ID = "0123456789abcdef0123456789abcdef";
const SPAN_ID = "fedcba9876543210";
const PROJECT_ID = "project-otlp";
const API_KEY_ID = "key-from-the-credential";

describe("given the API process composed a command queue", () => {
  describe("when an exporter posts a protobuf OTLP export", () => {
    it("hands the producer a recordSpan command for that span", async () => {
      const { api, commands } = mount();

      const response = await api.fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: { "content-type": "application/x-protobuf", "x-auth-token": "token" },
        body: protobufExport(),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        message: "Trace received successfully.",
        partialSuccess: { rejectedSpans: 0, errorMessage: "" },
      });

      expect(commands).toHaveLength(1);
      const [command] = commands;
      expect(command?.tenantId).toBe(PROJECT_ID);
      expect(decodeBase64OpenTelemetryId(command?.span.traceId)).toBe(TRACE_ID);
      expect(decodeBase64OpenTelemetryId(command?.span.spanId)).toBe(SPAN_ID);
      expect(command?.span.name).toBe("llm-call");
    });
  });

  describe("when an exporter posts the same export as JSON", () => {
    it("reaches the producer with the same trace id", async () => {
      const { api, commands } = mount();

      const response = await api.fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify(jsonExport()),
      });

      expect(response.status).toBe(200);
      expect(commands).toHaveLength(1);
      expect(decodeBase64OpenTelemetryId(commands[0]?.span.traceId)).toBe(TRACE_ID);
    });
  });

  describe("when the payload claims an API key id of its own", () => {
    it("drops the sender's copy and writes the credential's on the resource", async () => {
      const { api, commands } = mount();

      await api.fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify(
          jsonExport({
            attributes: [
              { key: "langwatch.api_key.id", value: { stringValue: "a-key-the-sender-picked" } },
            ],
          }),
        ),
      });

      // It is RESOURCE-level provenance, so a span-level copy is never
      // legitimate and is removed rather than corrected.
      const spanAttributes = commands[0]?.span.attributes ?? [];
      expect(spanAttributes.filter((a) => a.key === "langwatch.api_key.id")).toHaveLength(0);

      const resourceAttributes = commands[0]?.resource?.attributes ?? [];
      const written = resourceAttributes.filter((a) => a.key === "langwatch.api_key.id");
      expect(written).toHaveLength(1);
      expect(written[0]?.value).toEqual({ stringValue: API_KEY_ID });
    });
  });

  describe("when the credential is refused", () => {
    it("answers the refusal verbatim and enqueues nothing", async () => {
      const { api, commands } = mount({
        credential: () =>
          Promise.resolve({
            ok: false as const,
            status: 401 as const,
            body: { message: "Invalid auth token." },
          }),
      });

      const response = await api.fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(jsonExport()),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Invalid auth token." });
      expect(commands).toHaveLength(0);
    });
  });

  describe("when the body is not a parsable export", () => {
    it("answers 400 rather than enqueueing a span nobody can read", async () => {
      const { api, commands } = mount();

      const response = await api.fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: "{ this is not json",
      });

      expect(response.status).toBe(400);
      expect(commands).toHaveLength(0);
    });
  });

  describe("when an exporter posts to a signal this process folds nothing for", () => {
    it("is not served at all, rather than served over a stub", async () => {
      const { api } = mount();

      const logs = await api.fetch("/api/otel/v1/logs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: "{}",
      });
      const metrics = await api.fetch("/api/otel/v1/metrics", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: "{}",
      });

      expect(logs.status).toBe(404);
      expect(metrics.status).toBe(404);
    });
  });

  describe("when an exporter posts to a path a misconfiguration produced", () => {
    it("is served from the canonical route rather than redirected", async () => {
      const { api, commands } = mount();

      const response = await api.fetch("/v1/traces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify(jsonExport()),
      });

      expect(response.status).toBe(200);
      expect(commands).toHaveLength(1);
    });
  });
});

describe("given the API process composed no command queue", () => {
  describe("when the REST features are built", () => {
    it("mounts no OTLP receiver at all", async () => {
      const ports = composeApiTraceIngest({
        eventing: undefined,
        redis: null,
        credentials: credentialsStub(),
        processName: "langwatch-api-test",
      });
      expect(ports).toBeUndefined();

      const hono = new Hono();
      for (const app of createApiProcessRestFeatures({
        security: passThroughSecurity(),
        ports: {
          handlerManagedCredential: () => {
            throw new Error("unreachable");
          },
          rateLimit: async () => ({ allowed: true }),
        },
      })) {
        hono.route("/", app);
      }

      const response = await hono.fetch(
        new Request("http://api.test/api/otel/v1/traces", { method: "POST", body: "{}" }),
      );
      expect(response.status).toBe(404);
    });
  });
});

// --------------------------------------------------------------------------

type MountOverrides = {
  credential?: ApiHandlerManagedCredentials["authenticate"];
};

/**
 * The process's REST door, over a producer that records rather than enqueues.
 *
 * `register` answers a `recordSpan` sender that pushes into an array, which is
 * the one seam a test can hold: everything on the customer's side of it is the
 * real path.
 */
function mount(overrides: MountOverrides = {}) {
  const commands: RecordSpanCommandData[] = [];
  const send = vi.fn(async (data: RecordSpanCommandData) => {
    commands.push(data);
  });

  const otlpIngest = composeApiTraceIngest({
    eventing: recordingEventing(send),
    redis: null,
    credentials: credentialsStub(overrides.credential),
    processName: "langwatch-api-test",
  });
  if (!otlpIngest) throw new Error("the OTLP ports must compose over a command queue");

  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the OTLP family resolves its credential through its own port.");
      },
      rateLimit: async () => ({ allowed: true }),
      otlpIngest,
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
          project: {
            id: PROJECT_ID,
            name: "OTLP",
            slug: "otlp",
            teamId: "team-1",
            organizationId: "org-1",
            isPersonal: false,
            ownerUserId: null,
          },
          resolved: {
            type: "apiKey" as const,
            apiKeyId: API_KEY_ID,
            userId: null,
            organizationId: "org-1",
            ingestSourceType: null,
            ingestionTemplateId: null,
            project: {
              id: PROJECT_ID,
              name: "OTLP",
              slug: "otlp",
              teamId: "team-1",
              organizationId: "org-1",
              isPersonal: false,
              ownerUserId: null,
            },
          },
          markUsed: () => void 0,
        })),
  } as never;
}

/** One resource, one scope, one span — recent enough to pass the age guard. */
function jsonExport(span: { attributes?: unknown[] } = {}) {
  const now = Date.now();
  return {
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [
          {
            scope: { name: "test", version: "1", attributes: [] },
            spans: [
              {
                traceId: Buffer.from(TRACE_ID, "hex").toString("base64"),
                spanId: Buffer.from(SPAN_ID, "hex").toString("base64"),
                parentSpanId: "",
                name: "llm-call",
                kind: 3,
                startTimeUnixNano: String((now - 1000) * 1_000_000),
                endTimeUnixNano: String(now * 1_000_000),
                attributes: span.attributes ?? [],
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

/** The same export, encoded the way most production collectors send it. */
function protobufExport(): ArrayBuffer {
  const now = Date.now();
  const message = traceRequestType.create({
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [
          {
            scope: { name: "test", version: "1" },
            spans: [
              {
                traceId: Buffer.from(TRACE_ID, "hex"),
                spanId: Buffer.from(SPAN_ID, "hex"),
                name: "llm-call",
                kind: 3,
                startTimeUnixNano: (now - 1000) * 1_000_000,
                endTimeUnixNano: now * 1_000_000,
                attributes: [],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ],
  });
  const encoded: Uint8Array = traceRequestType.encode(message).finish();
  // Copied into a buffer of its own rather than handed `encoded.buffer`. Under
  // Node protobufjs writes into a pooled `Buffer`, so the underlying arena is
  // longer than the message — and `Buffer.prototype.slice` is a VIEW, not a
  // copy, so the obvious spelling posts trailing bytes from someone else's
  // write and the receiver answers 400.
  return Uint8Array.from(encoded).buffer as ArrayBuffer;
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
