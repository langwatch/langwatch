/**
 * Public HTTP contract for the OTLP and webhook ingestion receivers.
 *
 * It covers bearer/source binding, source-type routing, lazy governance-project
 * creation, authoritative origin attributes, trace/log handoff, and
 * `lastEventAt`. Hono's request client exercises the route against Prisma while
 * trace-pipeline spies keep downstream persistence out of this suite.
 *
 * See the receiver-shapes, architecture-invariants and compliance-baseline
 * specifications for the complete contract.
 */

import { PROJECT_KIND } from "@langwatch/project-contract";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";

import { app as ingestApp } from "../ingestionRoutes";

const suffix = nanoid(8);
const NS = `ingest-http-${suffix}`;
let testApp: App;

interface SeededOrg {
  organizationId: string;
  teamId: string;
  userId: string;
  ingestionSourceId: string;
  ingestSecret: string;
  sourceType: string;
}

async function seedOrgWithIngestionSource({
  sourceType,
}: {
  sourceType: "otel_generic" | "claude_cowork" | "workato" | "s3_custom";
}): Promise<SeededOrg> {
  const orgSuffix = nanoid(8);
  const org = await prisma.organization.create({
    data: {
      name: `Org ${NS}-${orgSuffix}`,
      slug: `org-${NS}-${orgSuffix}`,
    },
  });
  const team = await prisma.team.create({
    data: {
      name: `Team ${NS}-${orgSuffix}`,
      slug: `team-${NS}-${orgSuffix}`,
      organizationId: org.id,
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `user-${NS}-${orgSuffix}@example.com`,
      name: `User ${NS}-${orgSuffix}`,
    },
  });
  await prisma.organizationUser.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: "ADMIN",
    },
  });
  const { source, ingestSecret } = await testApp.governance.ingestionSourceCreate({
    organizationId: org.id,
    sourceType,
    name: `Source ${NS}-${orgSuffix}`,
    actorUserId: user.id,
  });
  return {
    organizationId: org.id,
    teamId: team.id,
    userId: user.id,
    ingestionSourceId: source.id,
    ingestSecret,
    sourceType,
  };
}

async function deleteSeededOrg(seed: SeededOrg | null): Promise<void> {
  if (!seed) return;
  await prisma.ingestionSource
    .delete({ where: { id: seed.ingestionSourceId } })
    .catch(() => undefined);
  await prisma.project
    .deleteMany({ where: { team: { organizationId: seed.organizationId } } })
    .catch(() => undefined);
  await prisma.organizationUser
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => undefined);
  await prisma.team
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => undefined);
  await prisma.organization
    .delete({ where: { id: seed.organizationId } })
    .catch(() => undefined);
  await prisma.user.delete({ where: { id: seed.userId } }).catch(() => undefined);
}

function buildOtlpJsonBody(opts: { spanCount?: number; spanNamePrefix?: string } = {}): {
  body: ArrayBuffer;
  spanCount: number;
} {
  const startNano = String(BigInt(Date.now()) * 1_000_000n);
  const endNano = String((BigInt(Date.now()) + 100n) * 1_000_000n);
  const spanCount = opts.spanCount ?? 1;
  const namePrefix = opts.spanNamePrefix ?? "ingest-canary-span";
  const spans = Array.from({ length: spanCount }, (_, i) => ({
    traceId: "0".repeat(31) + "1",
    spanId: i.toString(16).padStart(16, "0"),
    name: spanCount === 1 ? namePrefix : `${namePrefix}-${i}`,
    kind: 1,
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    attributes: [
      {
        key: "user.email",
        value: { stringValue: "test@example.com" },
      },
    ],
    status: { code: 1 },
  }));
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: "test", version: "1.0" },
            spans,
          },
        ],
      },
    ],
  };
  const body = new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer;
  return { body, spanCount };
}

function buildOtlpLogsJsonBody(): ArrayBuffer {
  const nowNano = String(BigInt(Date.now()) * 1_000_000n);
  const payload = {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            scope: { name: "test", version: "1.0" },
            logRecords: [
              {
                timeUnixNano: nowNano,
                observedTimeUnixNano: nowNano,
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: "ingest-canary-log" },
                attributes: [{ key: "event.name", value: { stringValue: "canary" } }],
              },
            ],
          },
        ],
      },
    ],
  };
  return new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer;
}

const handleTraceSpy = vi.fn(
  async (_tenantId: string, _request: unknown, _piiRedactionLevel?: unknown) => ({
    rejectedSpans: 0,
  }),
);
const handleLogSpy = vi.fn(async (_args: unknown) => undefined);

vi.mock("~/server/app-layer/app", async () => {
  const actual = await vi.importActual<typeof import("~/server/app-layer/app")>(
    "~/server/app-layer/app",
  );
  return {
    ...actual,
    getApp: () =>
      new Proxy(actual.getApp(), {
        get(target, property, receiver) {
          if (property === "traces") {
            return {
              collection: { handleOtlpTraceRequest: handleTraceSpy },
              logCollection: { handleOtlpLogRequest: handleLogSpy },
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
  };
});

describe("/api/ingest/* — end-to-end HTTP receiver contract", () => {
  let otelSeed: SeededOrg | null = null;
  let coworkSeed: SeededOrg | null = null;
  let workatoSeed: SeededOrg | null = null;
  let crossOrgSeed: SeededOrg | null = null;

  beforeAll(async () => {
    await resetApp();
    testApp = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async () => ({ ...FREE_PLAN, type: "ENTERPRISE" }),
      }),
    });
    globalForApp.__langwatch_app = testApp;
    otelSeed = await seedOrgWithIngestionSource({ sourceType: "otel_generic" });
    coworkSeed = await seedOrgWithIngestionSource({
      sourceType: "claude_cowork",
    });
    workatoSeed = await seedOrgWithIngestionSource({ sourceType: "workato" });
    crossOrgSeed = await seedOrgWithIngestionSource({
      sourceType: "otel_generic",
    });
  });

  afterAll(async () => {
    await deleteSeededOrg(otelSeed);
    await deleteSeededOrg(coworkSeed);
    await deleteSeededOrg(workatoSeed);
    await deleteSeededOrg(crossOrgSeed);
    await resetApp();
  });

  describe("POST /api/ingest/otel/:sourceId — span-shaped sources", () => {
    describe("auth contract", () => {
      it("rejects missing Authorization header with 401", async () => {
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resourceSpans: [] }),
          },
        );
        expect(res.status).toBe(401);
      });

      it("rejects malformed Bearer token with 401", async () => {
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer not_a_valid_token_format",
            },
            body: JSON.stringify({ resourceSpans: [] }),
          },
        );
        expect(res.status).toBe(401);
      });

      it("rejects unknown but well-formed Bearer with 401", async () => {
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer lw_is_${"x".repeat(40)}`,
            },
            body: JSON.stringify({ resourceSpans: [] }),
          },
        );
        expect(res.status).toBe(401);
      });

      it("rejects when Bearer's source.id does not match :sourceId path param (cross-org tenant isolation) with 401", async () => {
        const res = await ingestApp.request(
          `/api/ingest/otel/${crossOrgSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: JSON.stringify({ resourceSpans: [] }),
          },
        );
        expect(res.status).toBe(401);
      });
    });

    describe("source-type routing", () => {
      it("rejects log-shaped source on /otel/ with 400 wrong_endpoint", async () => {
        const res = await ingestApp.request(
          `/api/ingest/otel/${workatoSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${workatoSeed!.ingestSecret}`,
            },
            body: JSON.stringify({ resourceSpans: [] }),
          },
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("wrong_endpoint");
      });
    });

    describe("happy path: valid Bearer + valid OTLP body", () => {
      it("accepts the request, lazy-ensures the hidden Gov Project, stamps origin metadata, and hands off to the unified trace pipeline", async () => {
        handleTraceSpy.mockClear();
        const { body, spanCount } = buildOtlpJsonBody();

        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: new Uint8Array(body),
          },
        );

        expect(res.status).toBe(202);
        const responseBody = (await res.json()) as {
          accepted: boolean;
          bytes: number;
          events: number;
        };
        expect(responseBody.accepted).toBe(true);
        expect(responseBody.events).toBe(spanCount);
        expect(responseBody.bytes).toBeGreaterThan(0);

        const govProjects = await prisma.project.findMany({
          where: {
            kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
            team: { organizationId: otelSeed!.organizationId },
          },
        });
        expect(govProjects).toHaveLength(1);
        const govProject = govProjects[0]!;

        expect(handleTraceSpy).toHaveBeenCalledTimes(1);
        const [tenantId, parsedRequest] = handleTraceSpy.mock.calls[0]!;
        expect(tenantId).toBe(govProject.id);

        const allSpans = ((parsedRequest as any).resourceSpans ?? []).flatMap((rs: any) =>
          (rs.scopeSpans ?? []).flatMap((ss: any) => ss.spans ?? []),
        );
        expect(allSpans).toHaveLength(spanCount);

        const stampedAttrs = (allSpans[0]?.attributes ?? []).map((a: any) => a.key);
        expect(stampedAttrs).toContain("langwatch.origin.kind");
        expect(stampedAttrs).toContain("langwatch.ingestion_source.id");
        expect(stampedAttrs).toContain("langwatch.ingestion_source.organization_id");
        expect(stampedAttrs).toContain("langwatch.ingestion_source.source_type");

        const sourceIdAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.id",
        );
        expect(sourceIdAttr?.value?.stringValue).toBe(otelSeed!.ingestionSourceId);

        const orgIdAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.organization_id",
        );
        expect(orgIdAttr?.value?.stringValue).toBe(otelSeed!.organizationId);

        const sourceTypeAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.source_type",
        );
        expect(sourceTypeAttr?.value?.stringValue).toBe("otel_generic");
      });

      it("preserves the caller's original span attributes alongside origin metadata", async () => {
        handleTraceSpy.mockClear();
        const { body } = buildOtlpJsonBody();
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: new Uint8Array(body),
          },
        );
        expect(res.status).toBe(202);
        const [, parsedRequest] = handleTraceSpy.mock.calls[0]!;
        const allSpans = ((parsedRequest as any).resourceSpans ?? []).flatMap((rs: any) =>
          (rs.scopeSpans ?? []).flatMap((ss: any) => ss.spans ?? []),
        );
        const userEmailAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "user.email",
        );
        expect(userEmailAttr?.value?.stringValue).toBe("test@example.com");
      });

      it("ack's empty body without invoking handleOtlpTraceRequest (defensive: no spans, nothing to forward)", async () => {
        handleTraceSpy.mockClear();
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: "",
          },
        );
        expect(res.status).toBe(202);
        const responseBody = (await res.json()) as {
          accepted: boolean;
          bytes: number;
          events: number;
        };
        expect(responseBody.accepted).toBe(true);
        expect(responseBody.events).toBe(0);
        expect(responseBody.bytes).toBe(0);
        expect(handleTraceSpy).not.toHaveBeenCalled();
      });

      it("returns a parser hint when bytes>0 but body does not parse as OTLP", async () => {
        handleTraceSpy.mockClear();
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: "this is not OTLP",
          },
        );
        expect(res.status).toBe(202);
        const responseBody = (await res.json()) as {
          events: number;
          bytes: number;
          hint?: string;
        };
        expect(responseBody.events).toBe(0);
        expect(responseBody.bytes).toBeGreaterThan(0);
        expect(responseBody.hint).toMatch(/Body did not parse|OTLP/);
        expect(handleTraceSpy).not.toHaveBeenCalled();
      });
    });

    describe("hidden Gov Project lifecycle", () => {
      it("subsequent posts reuse the same Gov Project (idempotent ensureHiddenGovernanceProject)", async () => {
        handleTraceSpy.mockClear();
        const { body } = buildOtlpJsonBody();

        for (let i = 0; i < 3; i++) {
          const res = await ingestApp.request(
            `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${otelSeed!.ingestSecret}`,
              },
              body: new Uint8Array(body),
            },
          );
          expect(res.status).toBe(202);
        }

        const govProjects = await prisma.project.findMany({
          where: {
            kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
            team: { organizationId: otelSeed!.organizationId },
          },
        });
        expect(govProjects).toHaveLength(1);
      });
    });

    describe("lastEventAt tracking", () => {
      it("advances lastEventAt on every successful post (powers composer awaiting → active flip)", async () => {
        const before = await prisma.ingestionSource.findUnique({
          where: { id: otelSeed!.ingestionSourceId },
        });

        const { body } = buildOtlpJsonBody();
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: new Uint8Array(body),
          },
        );
        expect(res.status).toBe(202);

        const after = await prisma.ingestionSource.findUnique({
          where: { id: otelSeed!.ingestionSourceId },
        });
        expect(after?.lastEventAt).not.toBeNull();
        if (before?.lastEventAt && after?.lastEventAt) {
          expect(after.lastEventAt.getTime()).toBeGreaterThanOrEqual(
            before.lastEventAt.getTime(),
          );
        }
      });
    });
  });

  describe("POST /api/ingest/otel/:sourceId/v1/logs — OTLP log records", () => {
    describe("happy path: valid Bearer + valid OTLP logs body", () => {
      it("stamps origin metadata on every log record before handing off to the log pipeline", async () => {
        handleLogSpy.mockClear();
        const res = await ingestApp.request(
          `/api/ingest/otel/${otelSeed!.ingestionSourceId}/v1/logs`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${otelSeed!.ingestSecret}`,
            },
            body: new Uint8Array(buildOtlpLogsJsonBody()),
          },
        );
        expect(res.status).toBe(202);
        expect(handleLogSpy).toHaveBeenCalledTimes(1);

        const { logRequest } = handleLogSpy.mock.calls[0]![0] as {
          logRequest: {
            resourceLogs?: {
              scopeLogs?: {
                logRecords?: { attributes?: { key: string }[] }[];
              }[];
            }[];
          };
        };
        const record = logRequest.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0];
        const attrKeys = (record?.attributes ?? []).map((a) => a.key);
        expect(attrKeys).toContain("langwatch.origin.kind");
        expect(attrKeys).toContain("langwatch.ingestion_source.id");
        // The caller's own attributes survive alongside the stamped origin.
        expect(attrKeys).toContain("event.name");
      });
    });
  });

  describe("POST /api/ingest/webhook/:sourceId — flat-event sources", () => {
    describe("auth contract", () => {
      it("rejects missing Authorization header with 401", async () => {
        const res = await ingestApp.request(
          `/api/ingest/webhook/${workatoSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: "test" }),
          },
        );
        expect(res.status).toBe(401);
      });

      it("rejects when Bearer's source.id does not match :sourceId path param (cross-org tenant isolation) with 401", async () => {
        // Use orgA's bearer (workatoSeed) against orgB's source path
        // (crossOrgSeed lives in a different organization) — proves the
        // webhook receiver enforces the same isolation invariant as /otel/.
        const res = await ingestApp.request(
          `/api/ingest/webhook/${crossOrgSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${workatoSeed!.ingestSecret}`,
            },
            body: JSON.stringify({ event: "test" }),
          },
        );
        expect(res.status).toBe(401);
      });
    });

    describe("source-type routing", () => {
      it("rejects span-shaped (claude_cowork) source on /webhook/ with 400 wrong_endpoint", async () => {
        const res = await ingestApp.request(
          `/api/ingest/webhook/${coworkSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${coworkSeed!.ingestSecret}`,
            },
            body: JSON.stringify({ event: "test" }),
          },
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("wrong_endpoint");
      });
    });

    describe("happy path: valid webhook payload", () => {
      it("maps the JSON envelope to a single OTLP log_record with origin metadata + hands off to log pipeline", async () => {
        handleLogSpy.mockClear();
        const envelope = JSON.stringify({
          event: "user.action",
          actor: "test@example.com",
          ts: Date.now(),
        });

        const res = await ingestApp.request(
          `/api/ingest/webhook/${workatoSeed!.ingestionSourceId}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${workatoSeed!.ingestSecret}`,
            },
            body: envelope,
          },
        );

        expect(res.status).toBe(202);
        const responseBody = (await res.json()) as {
          accepted: boolean;
          bytes: number;
          eventId: string;
        };
        expect(responseBody.accepted).toBe(true);
        expect(responseBody.bytes).toBeGreaterThan(0);
        expect(responseBody.eventId).toMatch(/^envelope-/);

        const govProjects = await prisma.project.findMany({
          where: {
            kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
            team: { organizationId: workatoSeed!.organizationId },
          },
        });
        expect(govProjects).toHaveLength(1);
        const govProject = govProjects[0]!;

        expect(handleLogSpy).toHaveBeenCalledTimes(1);
        const [args] = handleLogSpy.mock.calls[0]!;
        const callArgs = args as {
          tenantId: string;
          logRequest: { resourceLogs: any[] };
        };
        expect(callArgs.tenantId).toBe(govProject.id);

        const allRecords = (callArgs.logRequest.resourceLogs ?? []).flatMap((rl: any) =>
          (rl.scopeLogs ?? []).flatMap((sl: any) => sl.logRecords ?? []),
        );
        expect(allRecords).toHaveLength(1);

        const record = allRecords[0]!;
        const attrKeys = (record.attributes ?? []).map((a: any) => a.key);
        expect(attrKeys).toContain("langwatch.origin.kind");
        expect(attrKeys).toContain("langwatch.ingestion_source.id");
        expect(attrKeys).toContain("langwatch.ingestion_source.organization_id");
        expect(attrKeys).toContain("langwatch.ingestion_source.source_type");

        const sourceTypeAttr = (record.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.source_type",
        );
        expect(sourceTypeAttr?.value?.stringValue).toBe("workato");

        expect(record.body?.stringValue).toBe(envelope);
      });
    });
  });
});
