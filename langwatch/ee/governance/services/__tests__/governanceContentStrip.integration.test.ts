/**
 * @vitest-environment node
 *
 * Phase 9 — receiver-side gen_ai content stripping ("no-spy mode").
 * End-to-end integration test that:
 *   1. Creates two real Organizations in PG (one full, one strip_io)
 *   2. Routes spans through the production SpanAppendStore
 *   3. Reads stored_spans BACK from CH and asserts:
 *        - strip_io org's gateway-origin span has gen_ai.input.messages /
 *          gen_ai.output.messages / gen_ai.system_instructions REMOVED
 *        - full org's gateway-origin span retains all content
 *        - strip_io org's NON-gateway-origin span (customer-app trace)
 *          retains all content (we don't strip user-app traces)
 *        - strip_all picks up tool_call payloads on top of strip_io
 *
 * Hits real Prisma + real ClickHouse via testContainers. No mocks for
 * the org-mode lookup, no mocks for the CH client. The test is the
 * "the policy is enforced by the pipeline" claim from the BDD spec
 * verified end-to-end.
 *
 * Spec: specs/ai-governance/no-spy-mode/no-spy-mode.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GovernanceContentStripService } from "@ee/governance/services/governanceContentStrip.service";

import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { SpanAppendStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.store";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  cleanupTestData,
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const suffix = nanoid(8);
const ORG_FULL_ID = `org-nospy-full-${suffix}`;
const ORG_STRIP_IO_ID = `org-nospy-stripio-${suffix}`;
const ORG_STRIP_ALL_ID = `org-nospy-stripall-${suffix}`;
const TENANT_FULL = `tenant-nospy-full-${suffix}`;
const TENANT_STRIP_IO = `tenant-nospy-stripio-${suffix}`;
const TENANT_STRIP_ALL = `tenant-nospy-stripall-${suffix}`;

function gatewaySpanFixture({
  organizationId,
  tenantId,
  spanId,
  traceId,
  origin = "gateway",
}: {
  organizationId: string;
  tenantId: string;
  spanId: string;
  traceId: string;
  origin?: string;
}): NormalizedSpan {
  const now = Date.now();
  return {
    id: `proj-${spanId}`,
    tenantId,
    traceId,
    spanId,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: now,
    endTimeUnixMs: now + 100,
    durationMs: 100,
    name: "chat /v1/chat/completions",
    kind: 1,
    resourceAttributes: {},
    spanAttributes: {
      "langwatch.origin": origin,
      "langwatch.organization_id": organizationId,
      "gen_ai.input.messages": [
        { role: "user", content: "summarize Q3 numbers" },
      ],
      "gen_ai.output.messages": [
        { role: "assistant", content: "Revenue grew 12% YoY..." },
      ],
      "gen_ai.system_instructions": "You are a helpful assistant",
      "gen_ai.tool.call.arguments": JSON.stringify({
        query: "weather in Tokyo",
      }),
      "gen_ai.tool.call.result": "27°C, sunny",
      // Non-content metadata that MUST survive any strip mode
      "gen_ai.request.model": "gpt-5-mini",
      "gen_ai.usage.input_tokens": 42,
      "gen_ai.usage.output_tokens": 18,
    },
    statusCode: 1,
    statusMessage: null,
    instrumentationScope: { name: "langwatch-aigateway", version: "1.0.0" },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

async function readSpanAttrs(
  ch: ClickHouseClient,
  tenantId: string,
  spanId: string,
): Promise<Record<string, unknown> | null> {
  const result = await ch.query({
    query: `
      SELECT SpanAttributes
      FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND SpanId = {spanId:String}
      LIMIT 1
    `,
    query_params: { tenantId, spanId },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{
    SpanAttributes: Record<string, string>;
  }>;
  if (!rows[0]) return null;
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rows[0].SpanAttributes)) {
    try {
      decoded[k] = JSON.parse(v);
    } catch {
      decoded[k] = v;
    }
  }
  return decoded;
}

describe("GovernanceContentStripService — receiver-side strip in pipeline", () => {
  let ch: ClickHouseClient;
  let store: SpanAppendStore;

  beforeAll(async () => {
    await startTestContainers();
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) throw new Error("ClickHouse test container not available");
    ch = maybeCh;
    const repo = new SpanStorageClickHouseRepository(async () => ch);
    // Construct with a dedicated strip service so the in-process cache
    // stays scoped to this test file (the default singleton would leak
    // cached modes across other integration tests in the same run).
    store = new SpanAppendStore(repo, GovernanceContentStripService.create());

    await prisma.organization.create({
      data: {
        id: ORG_FULL_ID,
        name: `NoSpy Full ${suffix}`,
        slug: `nospy-full-${suffix}`,
        governanceLogContentMode: "full",
      },
    });
    await prisma.organization.create({
      data: {
        id: ORG_STRIP_IO_ID,
        name: `NoSpy StripIO ${suffix}`,
        slug: `nospy-strip-io-${suffix}`,
        governanceLogContentMode: "strip_io",
      },
    });
    await prisma.organization.create({
      data: {
        id: ORG_STRIP_ALL_ID,
        name: `NoSpy StripAll ${suffix}`,
        slug: `nospy-strip-all-${suffix}`,
        governanceLogContentMode: "strip_all",
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_FULL_ID, ORG_STRIP_IO_ID, ORG_STRIP_ALL_ID] } },
    });
    await cleanupTestData(TENANT_FULL);
    await cleanupTestData(TENANT_STRIP_IO);
    await cleanupTestData(TENANT_STRIP_ALL);
    await stopTestContainers();
  });

  describe("when org mode is 'full' (default)", () => {
    it("preserves gen_ai content end-to-end", async () => {
      const spanId = `span-full-${nanoid()}`;
      const traceId = `trace-full-${nanoid()}`;
      const span = gatewaySpanFixture({
        organizationId: ORG_FULL_ID,
        tenantId: TENANT_FULL,
        spanId,
        traceId,
      });
      await store.append(span, {
        aggregateId: traceId,
        tenantId: createTenantId(TENANT_FULL),
      });
      const stored = await readSpanAttrs(ch, TENANT_FULL, spanId);
      expect(stored).not.toBeNull();
      expect(stored!["gen_ai.input.messages"]).toBeDefined();
      expect(stored!["gen_ai.output.messages"]).toBeDefined();
      expect(stored!["gen_ai.system_instructions"]).toBe(
        "You are a helpful assistant",
      );
      expect(stored!["gen_ai.tool.call.arguments"]).toBeDefined();
      expect(stored!["gen_ai.tool.call.result"]).toBe("27°C, sunny");
      expect(stored!["langwatch.governance.content_stripped"]).toBeUndefined();
    });
  });

  describe("when org mode is 'strip_io'", () => {
    it("drops prompt + completion + system instructions, keeps everything else", async () => {
      const spanId = `span-strip-io-${nanoid()}`;
      const traceId = `trace-strip-io-${nanoid()}`;
      const span = gatewaySpanFixture({
        organizationId: ORG_STRIP_IO_ID,
        tenantId: TENANT_STRIP_IO,
        spanId,
        traceId,
      });
      await store.append(span, {
        aggregateId: traceId,
        tenantId: createTenantId(TENANT_STRIP_IO),
      });
      const stored = await readSpanAttrs(ch, TENANT_STRIP_IO, spanId);
      expect(stored).not.toBeNull();
      // Content keys must be GONE (CH never saw the content)
      expect(stored!["gen_ai.input.messages"]).toBeUndefined();
      expect(stored!["gen_ai.output.messages"]).toBeUndefined();
      expect(stored!["gen_ai.system_instructions"]).toBeUndefined();
      // Non-content metadata MUST survive (cost / debugging / governance
      // dashboards depend on these)
      expect(stored!["gen_ai.request.model"]).toBe("gpt-5-mini");
      expect(stored!["gen_ai.usage.input_tokens"]).toBe(42);
      expect(stored!["gen_ai.usage.output_tokens"]).toBe(18);
      expect(stored!["langwatch.organization_id"]).toBe(ORG_STRIP_IO_ID);
      // Strip-marker stamped so the UI can show the redaction banner
      expect(stored!["langwatch.governance.content_stripped"]).toBe(true);
      expect(stored!["langwatch.governance.content_strip_mode"]).toBe(
        "strip_io",
      );
      // Defense-in-depth: the literal user content string MUST NOT appear
      // anywhere in the stored attributes (catches missed canonical keys)
      const flat = JSON.stringify(stored);
      expect(flat).not.toContain("summarize Q3 numbers");
      expect(flat).not.toContain("Revenue grew 12%");
      expect(flat).not.toContain("You are a helpful assistant");
    });

    it("does NOT touch non-gateway-origin spans (customer-app traces remain intact)", async () => {
      const spanId = `span-userapp-${nanoid()}`;
      const traceId = `trace-userapp-${nanoid()}`;
      // Customer-instrumented trace via /api/otel/v1/traces — origin is
      // "application" (or absent), NOT "gateway". Even with strip_io
      // active, this content survives because the policy targets only
      // gateway-emitted spans.
      const span = gatewaySpanFixture({
        organizationId: ORG_STRIP_IO_ID,
        tenantId: TENANT_STRIP_IO,
        spanId,
        traceId,
        origin: "application",
      });
      await store.append(span, {
        aggregateId: traceId,
        tenantId: createTenantId(TENANT_STRIP_IO),
      });
      const stored = await readSpanAttrs(ch, TENANT_STRIP_IO, spanId);
      expect(stored).not.toBeNull();
      expect(stored!["gen_ai.input.messages"]).toBeDefined();
      expect(stored!["gen_ai.output.messages"]).toBeDefined();
      expect(stored!["gen_ai.system_instructions"]).toBe(
        "You are a helpful assistant",
      );
      expect(stored!["langwatch.governance.content_stripped"]).toBeUndefined();
    });
  });

  describe("when org mode is 'strip_all'", () => {
    it("strips IO + tool call payloads", async () => {
      const spanId = `span-strip-all-${nanoid()}`;
      const traceId = `trace-strip-all-${nanoid()}`;
      const span = gatewaySpanFixture({
        organizationId: ORG_STRIP_ALL_ID,
        tenantId: TENANT_STRIP_ALL,
        spanId,
        traceId,
      });
      await store.append(span, {
        aggregateId: traceId,
        tenantId: createTenantId(TENANT_STRIP_ALL),
      });
      const stored = await readSpanAttrs(ch, TENANT_STRIP_ALL, spanId);
      expect(stored).not.toBeNull();
      expect(stored!["gen_ai.input.messages"]).toBeUndefined();
      expect(stored!["gen_ai.output.messages"]).toBeUndefined();
      expect(stored!["gen_ai.system_instructions"]).toBeUndefined();
      expect(stored!["gen_ai.tool.call.arguments"]).toBeUndefined();
      expect(stored!["gen_ai.tool.call.result"]).toBeUndefined();
      // Non-content metadata still intact
      expect(stored!["gen_ai.request.model"]).toBe("gpt-5-mini");
      expect(stored!["langwatch.governance.content_strip_mode"]).toBe(
        "strip_all",
      );
      const flat = JSON.stringify(stored);
      expect(flat).not.toContain("weather in Tokyo");
      expect(flat).not.toContain("27°C");
    });
  });

  describe("cross-org isolation", () => {
    it("the strip filter does not leak across tenants when concurrent writes fire", async () => {
      const aSpanId = `span-iso-a-${nanoid()}`;
      const bSpanId = `span-iso-b-${nanoid()}`;
      const aTraceId = `trace-iso-a-${nanoid()}`;
      const bTraceId = `trace-iso-b-${nanoid()}`;
      // Use a fresh strip service so caching from earlier "full"
      // assertions doesn't influence the concurrent run.
      const isoStore = new SpanAppendStore(
        new SpanStorageClickHouseRepository(async () => ch),
        GovernanceContentStripService.create(),
      );
      await Promise.all([
        isoStore.append(
          gatewaySpanFixture({
            organizationId: ORG_STRIP_IO_ID,
            tenantId: TENANT_STRIP_IO,
            spanId: aSpanId,
            traceId: aTraceId,
          }),
          {
            aggregateId: aTraceId,
            tenantId: createTenantId(TENANT_STRIP_IO),
          },
        ),
        isoStore.append(
          gatewaySpanFixture({
            organizationId: ORG_FULL_ID,
            tenantId: TENANT_FULL,
            spanId: bSpanId,
            traceId: bTraceId,
          }),
          {
            aggregateId: bTraceId,
            tenantId: createTenantId(TENANT_FULL),
          },
        ),
      ]);
      const aStored = await readSpanAttrs(ch, TENANT_STRIP_IO, aSpanId);
      const bStored = await readSpanAttrs(ch, TENANT_FULL, bSpanId);
      expect(aStored!["gen_ai.input.messages"]).toBeUndefined();
      expect(bStored!["gen_ai.input.messages"]).toBeDefined();
    });
  });
});
