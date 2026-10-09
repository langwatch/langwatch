/**
 * @vitest-environment node
 *
 * #5753: the ordinary case. A project reads its own traces, a one-project
 * proof with no narrowing, and opens an llm span in the playground whose input
 * was offloaded to event_log. The link names its trace, so the read goes
 * through the proof and must restore the full content under that project, with
 * no internal pointer left for a client to see.
 *
 * The full content is seeded into a real event_log row under the project, and
 * the real BlobStore is spied on so the tenant of the read is visible.
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
import {
  BlobStore,
  type S3ClientResolver,
} from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  insertRows,
  installAggregateTraceApp,
} from "./helpers/aggregateTraceRoutes";
import {
  FULL_TURN,
  offloadedLlmRow,
  seedOffloadedInput,
} from "./helpers/offloadedPromptSeed";

const run = nanoid(8);
const TRACE_ID = `plain-offloaded-${run}`;
const EVENT_ID = `evt-plain-${run}`;

let ch: ClickHouseClient;
let fixture: AggregateFixture;
let project: Project;
let admin: ReturnType<typeof appRouter.createCaller>;
let occurredAt: number;
let spanId: string;
let eventLogReads: ReturnType<typeof vi.spyOn>;

const tenantsRead = (): string[] =>
  eventLogReads.mock.calls.map(
    (call: unknown[]) => (call[0] as { tenantId: string }).tenantId,
  );

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const blobStore = new BlobStore({
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
    label: "plain-offloaded",
  });
  project = await fixture.makeTeamProject("ordinary");
  admin = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: fixture.admin.id }, expires: "1" },
    }),
  );

  occurredAt = Date.now() + 5_000;
  const row = offloadedLlmRow({
    tenantId: project.id,
    traceId: TRACE_ID,
    occurredAt,
    eventId: EVENT_ID,
  });
  spanId = row.SpanId;
  await insertRows({ ch, table: "stored_spans", values: [row] });
  await seedOffloadedInput({
    ch,
    tenantId: project.id,
    traceId: TRACE_ID,
    eventId: EVENT_ID,
  });
}, 180_000);

beforeEach(() => {
  eventLogReads.mockClear();
});

afterAll(async () => {
  try {
    await ch?.exec({
      query: `ALTER TABLE event_log DELETE WHERE TenantId = {id:String}`,
      query_params: { id: project?.id ?? "" },
    });
    await fixture?.cleanup();
  } finally {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await stopTestContainers();
  }
});

const open = () =>
  admin.spans.getForPromptStudio({
    projectId: project.id,
    spanId,
    traceId: TRACE_ID,
    occurredAtMs: occurredAt,
  });

describe("Feature: a project opens its own offloaded prompt", () => {
  describe("given an llm span whose input was offloaded to event_log", () => {
    describe("when the project opens it through a trace-named link", () => {
      /** @scenario "A trace-named link opens the full prompt from real stores" */
      it("returns the full message, not the stored preview", async () => {
        const span = await open();

        expect(span.messages.find((m) => m.role === "user")?.content).toBe(
          FULL_TURN,
        );
      });

      /** @scenario "A trace-named link opens the full prompt from real stores" */
      it("reads the offloaded content under the project's id only", async () => {
        await open();

        expect(new Set(tenantsRead())).toEqual(new Set([project.id]));
      });

      /** @scenario "A trace-named link opens the full prompt from real stores" */
      it("leaves no reserved eventref key in the result", async () => {
        const span = await open();

        expect(JSON.stringify(span)).not.toContain(
          "langwatch.reserved.eventref",
        );
      });
    });
  });
});
