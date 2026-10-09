/**
 * @vitest-environment node
 *
 * #5753: an aggregate opens a member's span in the playground and the span's
 * input was offloaded to event_log. The content lives outside ClickHouse's
 * fenced tables, under one project id, so the restore must read it under the
 * member the proof is narrowed to, never under the aggregate, and a trace the
 * aggregate does not read must restore nothing.
 *
 * The full content is seeded into a real event_log row under the member only,
 * and the real BlobStore is spied on so the tenant of every read is visible.
 *
 * Spec: specs/prompts/prompt-studio-full-content-resolution.feature.
 */
import type { ClickHouseClient } from "@clickhouse/client";
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
import type { Project } from "~/generated/prisma/client";
import { resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import {
  type AggregateFixture,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { AGGREGATE_PROJECT_KIND } from "~/server/app-layer/projects/project-kinds";
import { insertEventLogRow } from "~/server/app-layer/traces/__tests__/blob-offload-test-helpers";
import {
  BlobStore,
  type S3ClientResolver,
} from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  handledCodeOf,
  insertRows,
  installAggregateTraceApp,
  spanRow,
} from "./helpers/aggregateTraceRoutes";

const run = nanoid(8);
const traceIdOf = (handle: string) => `agg-offloaded-${handle}-${run}`;
const EVENT_ID = `evt-${run}`;

const messages = (userTurn: string) =>
  JSON.stringify([
    { role: "system", content: "You are a careful assistant." },
    { role: "user", content: userTurn },
  ]);
const FULL_TURN = `Summarise this: ${"x".repeat(70_000)}`;
const PREVIEW_TURN = "Summarise this: xxx…";

let ch: ClickHouseClient;
let fixture: AggregateFixture;
let aggregate: Project;
let member: Project;
let outsider: Project;
let admin: ReturnType<typeof appRouter.createCaller>;
let occurredAt: number;
let blobStore: BlobStore;
let eventLogReads: ReturnType<typeof vi.spyOn>;
const llmSpanIdOf = new Map<string, string>();

/** An llm span holding only the preview, under a pointer into event_log. */
function offloadedLlmRow({
  tenantId,
  traceId,
}: {
  tenantId: string;
  traceId: string;
}) {
  return {
    ...spanRow({ tenantId, traceId, occurredAt }),
    SpanAttributes: {
      "langwatch.span.type": "llm",
      "langwatch.input": messages(PREVIEW_TURN),
      [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
        field: "langwatch.input",
        eventId: EVENT_ID,
      }),
    },
  };
}

const tenantsRead = (): string[] =>
  eventLogReads.mock.calls.map(
    (call: unknown[]) => (call[0] as { tenantId: string }).tenantId,
  );

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  blobStore = new BlobStore({
    resolveS3Client: (async () => {
      throw new Error("no S3 on the event_log read path");
    }) as unknown as S3ClientResolver,
    resolveClickHouseClient: async () => ch,
  });
  eventLogReads = vi.spyOn(blobStore, "getFromEventLog");
  installAggregateTraceApp({
    ch,
    blobResolution: {
      blobStore,
      ioExtractionService: new TraceIOExtractionService(),
    },
  });
  fixture = await seedAggregateOrganization(prisma, {
    label: "agg-offloaded",
  });
  member = fixture.personal.engineer;
  outsider = await fixture.makeTeamProject("outsider");
  admin = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: fixture.admin.id }, expires: "1" },
    }),
  );

  const { projectSlug } = await admin.project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Company offloaded ${run}`,
    language: "other",
    framework: "other",
    kind: AGGREGATE_PROJECT_KIND,
    aggregateRule: { kind: "explicit", projectIds: [member.id] },
  });
  aggregate = await prisma.project.findFirstOrThrow({
    where: { slug: projectSlug, teamId: fixture.team.id },
  });

  occurredAt = Date.now() + 5_000;
  const rows = [
    { tenantId: member.id, traceId: traceIdOf("member") },
    { tenantId: outsider.id, traceId: traceIdOf("outsider") },
  ].map(offloadedLlmRow);
  for (const row of rows) llmSpanIdOf.set(row.TenantId, row.SpanId);
  await insertRows({ ch, table: "stored_spans", values: rows });

  // The full content exists under the member only: a read under any other
  // project id finds nothing and would fall back to the preview.
  await insertEventLogRow({
    client: ch,
    tenantId: member.id,
    aggregateId: traceIdOf("member"),
    eventId: EVENT_ID,
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    eventVersion: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    eventData: {
      span: {
        attributes: [
          {
            key: "langwatch.input",
            value: { stringValue: messages(FULL_TURN) },
          },
        ],
      },
    },
  });
}, 180_000);

beforeEach(() => {
  eventLogReads.mockClear();
});

afterAll(async () => {
  try {
    await ch?.exec({
      query: `ALTER TABLE event_log DELETE WHERE TenantId = {id:String}`,
      query_params: { id: member?.id ?? "" },
    });
    await fixture?.cleanup();
  } finally {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await stopTestContainers();
  }
});

const open = ({ project, handle }: { project: Project; handle: string }) =>
  admin.spans.getForPromptStudio({
    projectId: aggregate.id,
    spanId: llmSpanIdOf.get(project.id) ?? "missing",
    traceId: traceIdOf(handle),
    tenantId: project.id,
    occurredAtMs: occurredAt,
  });

describe("Feature: an aggregate opens a member's offloaded prompt", () => {
  describe("given a member's llm span whose input was offloaded to event_log", () => {
    describe("when ana opens it from the aggregate through a trace-named link", () => {
      /** @scenario "An aggregate opens a member's offloaded prompt in full" */
      it("returns the full message, not the stored preview", async () => {
        const span = await open({ project: member, handle: "member" });

        expect(span.messages.find((m) => m.role === "user")?.content).toBe(
          FULL_TURN,
        );
      });

      /** @scenario "An aggregate opens a member's offloaded prompt in full" */
      it("reads the offloaded content under the member's project id only", async () => {
        await open({ project: member, handle: "member" });

        expect(new Set(tenantsRead())).toEqual(new Set([member.id]));
      });

      /** @scenario "An aggregate opens a member's offloaded prompt in full" */
      it("never reads the offloaded content under the aggregate's project id", async () => {
        await open({ project: member, handle: "member" });

        expect(tenantsRead()).not.toContain(aggregate.id);
      });
    });
  });

  describe("given a trace of a project the aggregate does not read", () => {
    describe("when ana opens its span through a trace-named link", () => {
      const refuse = () =>
        open({ project: outsider, handle: "outsider" })
          .then(() => null)
          .catch((error: unknown) => error);

      /** @scenario "A trace the aggregate does not read restores nothing" */
      it("answers not found", async () => {
        expect(handledCodeOf(await refuse())).toBe("trace_not_found");
      });

      /** @scenario "A trace the aggregate does not read restores nothing" */
      it("reads no offloaded content", async () => {
        await refuse();

        expect(eventLogReads).not.toHaveBeenCalled();
      });
    });
  });
});
