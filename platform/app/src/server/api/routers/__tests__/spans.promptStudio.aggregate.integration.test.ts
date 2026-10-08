/**
 * @vitest-environment node
 *
 * ADR-144 block F: opening a span in the prompt playground carries the proof.
 * A playground link from the trace drawer names the span's trace and, under
 * an aggregate, the member that holds it, so the read goes through the route's
 * proof narrowed to that member instead of looking the span up in the
 * aggregate's own tenant, which holds no spans. A link naming only the span
 * keeps reading the URL project, the way it always has on a plain project.
 *
 * Spec: specs/governance/aggregate-project.feature, section F.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import {
  type AggregateFixture,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { AGGREGATE_PROJECT_KIND } from "~/server/app-layer/projects/project-kinds";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  handledCodeOf,
  insertRows,
  installAggregateTraceApp,
  spanRow,
} from "./helpers/aggregateTraceRoutes";

const run = nanoid(8);
const traceIdOf = (handle: string) => `agg-playground-${handle}-${run}`;

let ch: ClickHouseClient;
let fixture: AggregateFixture;
let aggregate: Project;
let member: Project;
let outsider: Project;
let plain: Project;
let admin: ReturnType<typeof appRouter.createCaller>;
let occurredAt: number;
/** The llm span each project's trace holds, by the project that holds it. */
const llmSpanIdOf = new Map<string, string>();

/** An llm span whose messages and model name the tenant that holds it. */
function llmSpanRow({
  tenantId,
  traceId,
}: {
  tenantId: string;
  traceId: string;
}) {
  return {
    ...spanRow({ tenantId, traceId, occurredAt }),
    SpanName: `llm of ${tenantId}`,
    SpanAttributes: {
      "langwatch.span.type": "llm",
      "gen_ai.request.model": `model-of-${tenantId}`,
      "gen_ai.request.temperature": "0.7",
      "langwatch.input": JSON.stringify([
        { role: "system", content: `system of ${tenantId}` },
        { role: "user", content: `question of ${tenantId}` },
      ]),
      "langwatch.output": JSON.stringify([
        { role: "assistant", content: `answer of ${tenantId}` },
      ]),
    },
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  installAggregateTraceApp({
    ch,
    overrides: {
      // The span-only link reads the URL project through the legacy trace
      // service, which resolves its client here.
      clickhouse: {
        enabled: true,
        resolveClient: async () => ch,
        resolveOrganizationClient: async () => {
          throw new Error("no organization client in this suite");
        },
        allInstances: async () => [],
      },
    },
  });
  fixture = await seedAggregateOrganization(prisma, {
    label: "agg-playground",
  });
  member = fixture.personal.engineer;
  plain = fixture.shared;
  outsider = await fixture.makeTeamProject("outsider");
  admin = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: fixture.admin.id }, expires: "1" },
    }),
  );

  const { projectSlug } = await admin.project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Company playground ${run}`,
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
    { tenantId: plain.id, traceId: traceIdOf("plain") },
  ].map(llmSpanRow);
  for (const row of rows) llmSpanIdOf.set(row.TenantId, row.SpanId);
  await insertRows({ ch, table: "stored_spans", values: rows });
}, 180_000);

afterAll(async () => {
  try {
    await fixture?.cleanup();
  } finally {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await stopTestContainers();
  }
});

const spanIdOf = (project: Project): string => {
  const spanId = llmSpanIdOf.get(project.id);
  if (!spanId) throw new Error(`no span for ${project.id}`);
  return spanId;
};

describe("Feature: opening a span in the playground carries the proof", () => {
  describe("given an aggregate with a member holding a trace with an LLM span", () => {
    describe("when ana opens that span in the playground from the aggregate's drawer", () => {
      /** @scenario "A member span opens in the playground under the aggregate" */
      it("loads the member's messages and model", async () => {
        const span = await admin.spans.getForPromptStudio({
          projectId: aggregate.id,
          spanId: spanIdOf(member),
          traceId: traceIdOf("member"),
          tenantId: member.id,
          occurredAtMs: occurredAt,
        });

        expect(span.traceId).toBe(traceIdOf("member"));
        expect(span.llmConfig.model).toBe(`model-of-${member.id}`);
        expect(span.messages.map((message) => message.content)).toEqual([
          `system of ${member.id}`,
          `question of ${member.id}`,
          `answer of ${member.id}`,
        ]);
      });

      it("finds the member from the proof when the link names no member", async () => {
        const span = await admin.spans.getForPromptStudio({
          projectId: aggregate.id,
          spanId: spanIdOf(member),
          traceId: traceIdOf("member"),
        });

        expect(span.llmConfig.model).toBe(`model-of-${member.id}`);
      });

      it("answers a member the aggregate does not read as not found", async () => {
        const refusal = await admin.spans
          .getForPromptStudio({
            projectId: aggregate.id,
            spanId: spanIdOf(outsider),
            traceId: traceIdOf("outsider"),
            tenantId: outsider.id,
          })
          .then(() => null)
          .catch((error: unknown) => error);

        expect(handledCodeOf(refusal)).toBe("trace_not_found");
      });
    });
  });

  describe("given a plain project holding a trace with an LLM span", () => {
    describe("when ana opens that span from a link naming its trace, or only the span", () => {
      /** @scenario "A playground link on a plain project opens as before" */
      it("loads the same span either way", async () => {
        const named = await admin.spans.getForPromptStudio({
          projectId: plain.id,
          spanId: spanIdOf(plain),
          traceId: traceIdOf("plain"),
          occurredAtMs: occurredAt,
        });
        const spanOnly = await admin.spans.getForPromptStudio({
          projectId: plain.id,
          spanId: spanIdOf(plain),
        });

        expect(named.llmConfig.model).toBe(`model-of-${plain.id}`);
        expect(named).toEqual(spanOnly);
      });
    });
  });
});
