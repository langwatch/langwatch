import {
  DataPrivacyApi,
  PRIVACY_DROPPED_MARKER_ATTR,
  type DataPrivacyConfig,
} from "@langwatch/data-privacy-contract";
import { generate } from "@langwatch/ksuid";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * The worker records a span with the content its organization's privacy rule drops already gone.
 * The worker booted wholly live over the test Postgres, Redis and ClickHouse (§7); spans go in
 * through TraceApi and are read back from storage through it.
 * @vitest-environment node
 * @see specs/data-privacy/content-drop.feature
 */
import { TraceApi, type OtlpKeyValue, type RecordSpanCommandData } from "@langwatch/trace-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootLiveWorker, liveStoresConfigured, type LiveWorker } from "./worker-live.fixture.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** Its own Redis database keeps this worker's jobs from every other test process. */
const REDIS_DB_INDEX = "10";

const IO_ATTRIBUTES = {
  "langwatch.input": "the secret question",
  "langwatch.output": "the answer",
  "gen_ai.request.model": "gpt-5-mini",
};

type Worker = LiveWorker;

function keyValues(record: Record<string, string>): OtlpKeyValue[] {
  return Object.entries(record).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function dropping(categories: { input?: "drop"; output?: "drop" }): DataPrivacyConfig {
  return {
    categories: {
      input: { disposition: categories.input ?? "capture" },
      output: { disposition: categories.output ?? "capture" },
    },
  };
}

const ns = `content-drop-${generate("test").toString()}`;

/** One organization with one project, seeded as rows: no module owns a memory seam for them. */
async function seedProject(prisma: PrismaClient, suffix: string) {
  const organization = await prisma.organization.create({
    data: { name: "Content Drop Org", slug: `--test-org-${ns}-${suffix}` },
  });
  const team = await prisma.team.create({
    data: {
      name: "Content Drop Team",
      slug: `--test-team-${ns}-${suffix}`,
      organizationId: organization.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: "Content Drop Project",
      slug: `--test-project-${ns}-${suffix}`,
      apiKey: `--test-key-${ns}-${suffix}`,
      teamId: team.id,
      language: "python",
      framework: "openai",
    },
  });
  return { organizationId: organization.id, projectId: project.id };
}

/** Puts the whole organization under `config`. */
async function ruleFor({ application }: Worker, organizationId: string, config: DataPrivacyConfig) {
  await application.service(DataPrivacyApi).setForScope({
    organizationId,
    scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
    personalOnly: false,
    config,
  });
}

/**
 * Records one span through TraceApi and reads back the attribute keys the stored span holds.
 * The span is timed now: the table's retention drops rows older than its window.
 */
async function recordedSpanKeys(
  { application }: Worker,
  {
    projectId,
    traceId,
    resourceAttributes = {},
  }: { projectId: string; traceId: string; resourceAttributes?: Record<string, string> },
): Promise<string[]> {
  const endMs = Date.now();
  const data: RecordSpanCommandData = {
    tenantId: projectId,
    occurredAt: endMs,
    span: {
      traceId,
      spanId: "span-1",
      name: "test-span",
      kind: 1,
      startTimeUnixNano: `${endMs - 2000}000000`,
      endTimeUnixNano: `${endMs}000000`,
      attributes: keyValues(IO_ATTRIBUTES),
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: { attributes: keyValues(resourceAttributes) },
    instrumentationScope: { name: "test-scope" },
    piiRedactionLevel: "ESSENTIAL",
  };
  const traces = application.service(TraceApi);
  await traces.recordSpan(data);

  const stored = () => traces.findNormalizedSpansByTraceId({ tenantId: projectId, traceId });
  await expect.poll(async () => (await stored()).length, { timeout: 60_000 }).toBe(1);
  const [span] = await stored();
  return Object.keys(span?.spanAttributes ?? {});
}

describe.skipIf(!DB_URL || !liveStoresConfigured)(
  "given the worker records spans for a project",
  () => {
    const prisma = new PrismaClient({
      adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
    });
    let worker: Worker;

    beforeAll(async () => {
      worker = await bootLiveWorker({ environment: { REDIS_DB_INDEX } });
    });

    afterAll(async () => {
      await worker?.close();
      const where = { slug: { startsWith: `--test-org-${ns}` } };
      const organizations = await prisma.organization.findMany({ where, select: { id: true } });
      const organizationIds = organizations.map((organization) => organization.id);
      await prisma.project.deleteMany({
        where: { team: { organizationId: { in: organizationIds } } },
      });
      await prisma.team.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.$disconnect();
    });

    describe("when its organization's rule drops trace input", () => {
      /** @scenario Dropped input never reaches storage from the OpenTelemetry endpoint */
      it("records the span without its input, keeping its output and model", async () => {
        const { organizationId, projectId } = await seedProject(prisma, "otel");
        await ruleFor(worker, organizationId, dropping({ input: "drop" }));

        const keys = await recordedSpanKeys(worker, { projectId, traceId: "trace-otel" });

        expect(keys).not.toContain("langwatch.input");
        expect(keys).toContain("langwatch.output");
        expect(keys).toContain("gen_ai.request.model");
      });

      /** @scenario Dropping applies to traces from the REST collector too */
      it("drops the input of a span the REST collector sent as well", async () => {
        const { organizationId, projectId } = await seedProject(prisma, "rest");
        await ruleFor(worker, organizationId, dropping({ input: "drop" }));

        const keys = await recordedSpanKeys(worker, {
          projectId,
          traceId: "trace-rest",
          resourceAttributes: { "telemetry.sdk.name": "langwatch-rest" },
        });

        expect(keys).not.toContain("langwatch.input");
      });
    });

    describe("when its organization's rule drops input and output", () => {
      /** @scenario Dropping applies to gateway traffic */
      it("drops both from a gateway-origin span and marks the span as dropped", async () => {
        const { organizationId, projectId } = await seedProject(prisma, "gateway");
        await ruleFor(worker, organizationId, dropping({ input: "drop", output: "drop" }));

        const keys = await recordedSpanKeys(worker, {
          projectId,
          traceId: "trace-gateway",
          resourceAttributes: { "langwatch.origin": "gateway" },
        });

        expect(keys).not.toContain("langwatch.input");
        expect(keys).not.toContain("langwatch.output");
        expect(keys).toContain(PRIVACY_DROPPED_MARKER_ATTR);
      });
    });

    describe("when the trace summary folds a span whose input was dropped", () => {
      /** @scenario The trace-level computed input is cleared when input is dropped */
      it("reads back a folded summary with no computed input, keeping the computed output", async () => {
        const { organizationId, projectId } = await seedProject(prisma, "fold");
        await ruleFor(worker, organizationId, dropping({ input: "drop" }));

        await recordedSpanKeys(worker, { projectId, traceId: "trace-fold" });

        await expect
          .poll(() =>
            worker.application.service(TraceApi).findSummary({ projectId, traceId: "trace-fold" }),
          )
          .toMatchObject({ computedInput: null, computedOutput: expect.any(String) });
      });
    });

    describe("when a span was recorded before the rule existed", () => {
      /** @scenario Dropping does not scrub already-stored traces */
      it("keeps that span's input, dropping it only from spans recorded after", async () => {
        const { organizationId, projectId } = await seedProject(prisma, "retro");
        const before = await recordedSpanKeys(worker, { projectId, traceId: "trace-before" });
        await ruleFor(worker, organizationId, dropping({ input: "drop" }));

        const after = await recordedSpanKeys(worker, { projectId, traceId: "trace-after" });

        expect(before).toContain("langwatch.input");
        expect(after).not.toContain("langwatch.input");
      });
    });
  },
);
