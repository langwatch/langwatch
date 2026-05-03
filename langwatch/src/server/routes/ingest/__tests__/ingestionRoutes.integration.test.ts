/**
 * End-to-end HTTP integration tests for /api/ingest/otel/:sourceId and
 * /api/ingest/webhook/:sourceId — the two governance ingest entry points
 * Sergey landed in 2b-ii-a (0d07ac371) + 2b-ii-b (33a8cf6d0).
 *
 * Proves the unified-substrate contract end-to-end through the public
 * HTTP surface:
 *   1. Bearer auth resolves the IngestionSource exactly once per request.
 *   2. Auth contract: missing / malformed / mismatched Bearer → 401;
 *      sourceId path param mismatching the resolved IngestionSource → 401.
 *   3. Source-type routing: only span-shaped sources (otel_generic,
 *      claude_cowork) on /otel/; only flat-event sources (workato,
 *      otel_generic-as-callback, s3_custom) on /webhook/. Wrong endpoint
 *      → 400 wrong_endpoint.
 *   4. Hidden Gov Project lazy-ensured on first valid POST per org via
 *      the single central helper (Sergey 2b-i e2c30961a) — verified by
 *      reading Prisma post-request.
 *   5. Origin metadata stamped on every span before handoff:
 *      langwatch.origin.kind = "ingestion_source"
 *      langwatch.ingestion_source.{id, organization_id, source_type}
 *      langwatch.governance.retention_class
 *   6. Handoff target is the EXISTING trace pipeline
 *      (handleOtlpTraceRequest with the Gov Project as tenant) — verified
 *      by spy on getApp().traces.collection. No parallel CH writes.
 *   7. Webhook envelope mapped to a single OTLP log_record with origin
 *      metadata in the attributes; handoff via handleOtlpLogRequest.
 *   8. lastEventAt advances on every successful post (recordEventReceived
 *      called) — composer status flips awaiting → active downstream.
 *
 * Approach: Hono's app.request() test client + real Prisma against the
 * dev RDS (same pattern as auth-cli-governance.integration.test.ts) +
 * spy on getApp().traces.{collection,logCollection} via vi.spyOn so
 * the trace-pipeline downstream isn't required (already proven by
 * eventLogDurability.integration.test.ts).
 *
 * Spec coverage:
 *   - specs/ai-gateway/governance/receiver-shapes.feature (Lane-S)
 *   - specs/ai-gateway/governance/architecture-invariants.feature (Lane-B)
 *   - specs/ai-gateway/governance/retention.feature (Lane-S)
 *   - specs/ai-gateway/governance/compliance-baseline.feature (Lane-A)
 *
 * Pairs with:
 *   - parseOtlpBody.test.ts (38106f768 — parser-equivalence)
 *   - eventLogDurability.integration.test.ts (f25d713ab — durability)
 *   - governanceProject.service.integration.test.ts (0a2b7e8d9 — helper)
 *   - organization.prisma.repository.governance-filter.integration.test.ts
 *     (Alexis 94426716e — Layer-1 filter)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import { prisma } from "~/server/db";
import { IngestionSourceService } from "~/server/governance/activity-monitor/ingestionSource.service";
import { PROJECT_KIND } from "~/server/governance/governanceProject.service";

import { app as ingestApp } from "../ingestionRoutes";

const suffix = nanoid(8);
const NS = `ingest-http-${suffix}`;

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
  retentionClass,
}: {
  sourceType: "otel_generic" | "claude_cowork" | "workato" | "s3_custom";
  retentionClass?: "thirty_days" | "one_year" | "seven_years";
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
  const service = IngestionSourceService.create(prisma);
  const { source, ingestSecret } = await service.createSource({
    organizationId: org.id,
    sourceType,
    name: `Source ${NS}-${orgSuffix}`,
    actorUserId: user.id,
    retentionClass,
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

function buildOtlpJsonBody(
  opts: { spanCount?: number; spanNamePrefix?: string } = {},
): {
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
  const body = new TextEncoder().encode(JSON.stringify(payload))
    .buffer as ArrayBuffer;
  return { body, spanCount };
}

const handleTraceSpy = vi.fn(
  async (
    _tenantId: string,
    _request: unknown,
    _piiRedactionLevel?: unknown,
  ) => ({ rejectedSpans: 0 }),
);
const handleLogSpy = vi.fn(async (_args: unknown) => undefined);

vi.mock("~/server/app-layer/app", async () => {
  const actual = await vi.importActual<typeof import("~/server/app-layer/app")>(
    "~/server/app-layer/app",
  );
  return {
    ...actual,
    getApp: () =>
      ({
        traces: {
          collection: { handleOtlpTraceRequest: handleTraceSpy },
          logCollection: { handleOtlpLogRequest: handleLogSpy },
        },
        // IngestionSourceService.createSource asserts an Enterprise plan
        // (Phase 4b-4/5 service-layer 403). The seed flow below calls
        // that service in beforeAll, so the mocked app needs a
        // planProvider that returns ENTERPRISE — otherwise every seed
        // throws TRPCError FORBIDDEN before the receiver tests run.
        planProvider: {
          getActivePlan: async () => ({ type: "ENTERPRISE" }),
        },
      }) as never,
  };
});

describe("/api/ingest/* — end-to-end HTTP receiver contract", () => {
  let otelSeed: SeededOrg | null = null;
  let coworkSeed: SeededOrg | null = null;
  let workatoSeed: SeededOrg | null = null;
  let crossOrgSeed: SeededOrg | null = null;

  beforeAll(async () => {
    otelSeed = await seedOrgWithIngestionSource({ sourceType: "otel_generic" });
    coworkSeed = await seedOrgWithIngestionSource({ sourceType: "claude_cowork" });
    workatoSeed = await seedOrgWithIngestionSource({ sourceType: "workato" });
    crossOrgSeed = await seedOrgWithIngestionSource({ sourceType: "otel_generic" });
  });

  afterAll(async () => {
    await deleteSeededOrg(otelSeed);
    await deleteSeededOrg(coworkSeed);
    await deleteSeededOrg(workatoSeed);
    await deleteSeededOrg(crossOrgSeed);
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

        const allSpans = (
          (parsedRequest as any).resourceSpans ?? []
        ).flatMap((rs: any) =>
          (rs.scopeSpans ?? []).flatMap((ss: any) => ss.spans ?? []),
        );
        expect(allSpans).toHaveLength(spanCount);

        const stampedAttrs = (allSpans[0]?.attributes ?? []).map(
          (a: any) => a.key,
        );
        expect(stampedAttrs).toContain("langwatch.origin.kind");
        expect(stampedAttrs).toContain("langwatch.ingestion_source.id");
        expect(stampedAttrs).toContain("langwatch.ingestion_source.organization_id");
        expect(stampedAttrs).toContain("langwatch.ingestion_source.source_type");
        expect(stampedAttrs).toContain("langwatch.governance.retention_class");

        const sourceIdAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.id",
        );
        expect(sourceIdAttr?.value?.stringValue).toBe(otelSeed!.ingestionSourceId);

        const orgIdAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.organization_id",
        );
        expect(orgIdAttr?.value?.stringValue).toBe(otelSeed!.organizationId);

        const retentionAttr = (allSpans[0]?.attributes ?? []).find(
          (a: any) => a.key === "langwatch.governance.retention_class",
        );
        expect(retentionAttr?.value?.stringValue).toBe("thirty_days");

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
        const allSpans = (
          (parsedRequest as any).resourceSpans ?? []
        ).flatMap((rs: any) =>
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

        const allRecords = (callArgs.logRequest.resourceLogs ?? []).flatMap(
          (rl: any) =>
            (rl.scopeLogs ?? []).flatMap((sl: any) => sl.logRecords ?? []),
        );
        expect(allRecords).toHaveLength(1);

        const record = allRecords[0]!;
        const attrKeys = (record.attributes ?? []).map((a: any) => a.key);
        expect(attrKeys).toContain("langwatch.origin.kind");
        expect(attrKeys).toContain("langwatch.ingestion_source.id");
        expect(attrKeys).toContain("langwatch.ingestion_source.organization_id");
        expect(attrKeys).toContain("langwatch.ingestion_source.source_type");
        expect(attrKeys).toContain("langwatch.governance.retention_class");

        const sourceTypeAttr = (record.attributes ?? []).find(
          (a: any) => a.key === "langwatch.ingestion_source.source_type",
        );
        expect(sourceTypeAttr?.value?.stringValue).toBe("workato");

        expect(record.body?.stringValue).toBe(envelope);
      });
    });
  });

  // =========================================================================
  // Phase 5 — CH retention TTL atomicity
  // =========================================================================
  // End-to-end receiver→handoff invariant: every span/log handed off
  // to the trace pipeline MUST carry the right
  // `langwatch.governance.retention_class` attribute matching the source's
  // configured class. The CH write-side test
  // (retentionClass.integration.test.ts) already pins the
  // attribute→column mapping; this scenario closes the loop end-to-end
  // through the receiver so a write-side bug, race, or upstream miss
  // doesn't silently produce empty-RetentionClass rows that match no
  // TTL clause and never delete (compliance gap for paying
  // `seven_years` customers).
  //
  // Spec: specs/ai-gateway/governance/retention.feature
  // =========================================================================
  describe("retention atomicity: every handed-off span/log carries the source's retention class", () => {
    type RetentionClass = "thirty_days" | "one_year" | "seven_years";
    const retentionClasses: RetentionClass[] = [
      "thirty_days",
      "one_year",
      "seven_years",
    ];

    describe("OTLP receiver", () => {
      it.each(retentionClasses)(
        "stamps every span with retention_class=%s when the source is configured for it",
        async (retentionClass) => {
          handleTraceSpy.mockClear();
          const seed = await seedOrgWithIngestionSource({
            sourceType: "otel_generic",
            retentionClass,
          });
          try {
            // Two-span body proves the stamping applies to ALL spans,
            // not just the first one (catches a subtle for-of break /
            // attribute-array-shared-reference bug).
            const { body } = buildOtlpJsonBody({
              spanCount: 2,
              spanNamePrefix: `retention-${retentionClass}`,
            });
            const res = await ingestApp.request(
              `/api/ingest/otel/${seed.ingestionSourceId}`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${seed.ingestSecret}`,
                },
                body: new Uint8Array(body),
              },
            );
            expect(res.status).toBe(202);

            expect(handleTraceSpy).toHaveBeenCalledTimes(1);
            const handedOffRequest = handleTraceSpy.mock.calls[0]![1] as {
              resourceSpans?: Array<{
                scopeSpans?: Array<{
                  spans?: Array<{
                    attributes?: Array<{
                      key: string;
                      value?: { stringValue?: string };
                    }>;
                  }>;
                }>;
              }>;
            };
            const allSpans =
              handedOffRequest.resourceSpans?.flatMap(
                (rs) => rs.scopeSpans?.flatMap((ss) => ss.spans ?? []) ?? [],
              ) ?? [];

            // Every span must have the retention attribute, and it must
            // equal the source's class. Empty-string / missing / wrong
            // value all fail the compliance invariant.
            expect(allSpans.length).toBeGreaterThan(0);
            for (const span of allSpans) {
              const retentionAttr = (span.attributes ?? []).find(
                (a) => a.key === "langwatch.governance.retention_class",
              );
              expect(retentionAttr).toBeDefined();
              expect(retentionAttr?.value?.stringValue).toBe(retentionClass);
            }
          } finally {
            await deleteSeededOrg(seed);
          }
        },
      );
    });

    describe("webhook receiver", () => {
      it.each(retentionClasses)(
        "stamps the synthesised log_record with retention_class=%s when the source is configured for it",
        async (retentionClass) => {
          handleLogSpy.mockClear();
          const seed = await seedOrgWithIngestionSource({
            sourceType: "workato",
            retentionClass,
          });
          try {
            const envelope = JSON.stringify({
              event: "test",
              retentionExpected: retentionClass,
            });
            const res = await ingestApp.request(
              `/api/ingest/webhook/${seed.ingestionSourceId}`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${seed.ingestSecret}`,
                },
                body: envelope,
              },
            );
            expect(res.status).toBe(202);

            expect(handleLogSpy).toHaveBeenCalledTimes(1);
            const handedOffArgs = handleLogSpy.mock.calls[0]![0] as {
              tenantId: string;
              logRequest: {
                resourceLogs?: Array<{
                  scopeLogs?: Array<{
                    logRecords?: Array<{
                      attributes?: Array<{
                        key: string;
                        value?: { stringValue?: string };
                      }>;
                    }>;
                  }>;
                }>;
              };
              piiRedactionLevel?: unknown;
            };
            const allLogs =
              handedOffArgs.logRequest.resourceLogs?.flatMap(
                (rl) =>
                  rl.scopeLogs?.flatMap((sl) => sl.logRecords ?? []) ?? [],
              ) ?? [];

            expect(allLogs.length).toBeGreaterThan(0);
            for (const log of allLogs) {
              const retentionAttr = (log.attributes ?? []).find(
                (a) => a.key === "langwatch.governance.retention_class",
              );
              expect(retentionAttr).toBeDefined();
              expect(retentionAttr?.value?.stringValue).toBe(retentionClass);
            }
          } finally {
            await deleteSeededOrg(seed);
          }
        },
      );
    });
  });
});
