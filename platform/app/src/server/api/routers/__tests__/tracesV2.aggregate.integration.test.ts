/**
 * @vitest-environment node
 *
 * ADR-144 block F: the trace routes carry the proof. An organisation admin
 * opens an aggregate project through the real tRPC trace routes: the proof is
 * minted at the door from the real grants ledger (the aggregate created
 * through the new-project flow, its members attached by the real reconciler),
 * and every read goes to a real ClickHouse through the authorized client.
 * Nothing between the route and the store is stubbed; only services the
 * trace routes do not reach keep the test App's null defaults.
 *
 * Spec: specs/governance/aggregate-project.feature, section F.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
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
import { evaluationRunRepositoryFor } from "~/test-utils/evaluationRunRepository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  handledCodeOf,
  insertRows,
  installAggregateTraceApp,
  spanRow,
  summaryRow,
} from "./helpers/aggregateTraceRoutes";

const run = nanoid(8);
/** One trace per member, each named after the member that holds it. */
const traceIdOf = (handle: string) => `agg-route-${handle}-${run}`;
/** The id two members both hold: one trace crossing project lines. */
const TWIN_TRACE = `agg-route-twin-${run}`;

let ch: ClickHouseClient;
let fixture: AggregateFixture;
let aggregate: Project;
let outsider: Project;
let members: { handle: string; project: Project }[];
let admin: ReturnType<typeof appRouter.createCaller>;
/** Every row is written after the grants attached, inside their window. */
let occurredAt: number;
let window: { from: number; to: number };
/** The engineer's evaluation, which recorded the inputs it judged. */
let engineerEvaluationId: string;

function evaluationOf({
  traceId,
  evaluatorId,
}: {
  traceId: string;
  evaluatorId: string;
}): EvaluationRunData {
  return {
    evaluationId: `eval-${nanoid()}`,
    evaluatorId,
    evaluatorType: "langevals/basic",
    evaluatorName: evaluatorId,
    traceId,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    LastEventOccurredAt: occurredAt,
    archivedAt: null,
    scheduledAt: occurredAt,
    startedAt: occurredAt,
    completedAt: occurredAt,
    costId: null,
  };
}

async function insert(table: string, values: unknown[]) {
  await insertRows({ ch, table, values });
}

const memberId = (handle: string): string => {
  const member = members.find((candidate) => candidate.handle === handle);
  if (!member) throw new Error(`no member ${handle}`);
  return member.project.id;
};

const listAggregate = () =>
  admin.tracesV2.list({
    projectId: aggregate.id,
    timeRange: window,
    sort: { columnId: "timestamp", direction: "desc" },
    page: 1,
    pageSize: 100,
  });

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resolveClient = async () => ch;
  installAggregateTraceApp({ ch });
  fixture = await seedAggregateOrganization(prisma, { label: "agg-route" });
  outsider = await fixture.makeTeamProject("outsider");
  members = [
    { handle: "engineer", project: fixture.personal.engineer },
    { handle: "seller", project: fixture.personal.seller },
    { handle: "shared", project: fixture.shared },
  ];
  admin = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: fixture.admin.id }, expires: "1" },
    }),
  );

  // What an admin does: the new-project flow, with an explicit rule naming
  // two personal projects and a team project. Creation reconciles inside the
  // request, so the grants are live when it returns.
  const { projectSlug } = await admin.project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Company view ${run}`,
    language: "other",
    framework: "other",
    kind: AGGREGATE_PROJECT_KIND,
    aggregateRule: {
      kind: "explicit",
      projectIds: members.map((member) => member.project.id),
    },
  });
  aggregate = await prisma.project.findFirstOrThrow({
    where: { slug: projectSlug, teamId: fixture.team.id },
  });

  occurredAt = Date.now() + 5_000;
  window = {
    from: occurredAt - 60 * 60 * 1000,
    to: occurredAt + 60 * 60 * 1000,
  };
  const holders = [
    ...members.map(({ handle, project }) => ({
      tenantId: project.id,
      traceId: traceIdOf(handle),
    })),
    { tenantId: memberId("engineer"), traceId: TWIN_TRACE },
    { tenantId: memberId("seller"), traceId: TWIN_TRACE },
    { tenantId: outsider.id, traceId: traceIdOf("outsider") },
  ];
  await insert(
    "trace_summaries",
    holders.map((holder) => summaryRow({ ...holder, occurredAt })),
  );
  await insert(
    "stored_spans",
    holders.map((holder) => spanRow({ ...holder, occurredAt })),
  );
  const repository = evaluationRunRepositoryFor({ resolveClient });
  const engineerEvaluation = {
    ...evaluationOf({
      traceId: traceIdOf("engineer"),
      evaluatorId: "monitor-of-engineer",
    }),
    inputs: { input: `question of ${memberId("engineer")}` },
  };
  engineerEvaluationId = engineerEvaluation.evaluationId;
  await repository.upsert(engineerEvaluation, memberId("engineer"));
  await repository.upsert(
    evaluationOf({ traceId: TWIN_TRACE, evaluatorId: "monitor-of-engineer" }),
    memberId("engineer"),
  );
  await repository.upsert(
    evaluationOf({ traceId: TWIN_TRACE, evaluatorId: "monitor-of-seller" }),
    memberId("seller"),
  );
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

describe("Feature: trace routes carry the proof", () => {
  describe("given an aggregate project with three members", () => {
    describe("when ana opens its trace list", () => {
      /** @scenario "An organisation admin opens the aggregate project" */
      it("lists every member's traces as first-class rows, each naming its member", async () => {
        const page = await listAggregate();
        const rows = page.items
          .filter((item) => item.traceId !== TWIN_TRACE)
          .map((item) => ({ traceId: item.traceId, projectId: item.projectId }))
          .sort((a, b) => a.traceId.localeCompare(b.traceId));

        expect(rows).toEqual(
          members
            .map(({ handle, project }) => ({
              traceId: traceIdOf(handle),
              projectId: project.id,
            }))
            .sort((a, b) => a.traceId.localeCompare(b.traceId)),
        );
        expect(page.items.map((item) => item.projectId)).not.toContain(
          outsider.id,
        );
      });
    });
  });

  describe("given an aggregate project with a member holding one trace", () => {
    describe("when ana opens that trace from the aggregate's list", () => {
      /** @scenario "A member trace opens in detail under the aggregate" */
      it("shows the member's spans and names the member as the owner", async () => {
        const row = (await listAggregate()).items.find(
          (item) => item.traceId === traceIdOf("engineer"),
        );
        if (!row) throw new Error("the engineer's trace is not listed");

        const header = await admin.tracesV2.header({
          projectId: aggregate.id,
          traceId: row.traceId,
          occurredAtMs: row.timestamp,
          tenantId: row.projectId,
          full: false,
        });
        const spans = await admin.tracesV2.spanTree({
          projectId: aggregate.id,
          traceId: row.traceId,
          occurredAtMs: row.timestamp,
          tenantId: header.projectId,
        });

        expect(header.projectId).toBe(memberId("engineer"));
        expect(header.projectId).not.toBe(aggregate.id);
        expect(spans.map((span) => span.name)).toEqual([
          `span of ${memberId("engineer")}`,
        ]);
      });

      it("refuses a member the proof does not read, whatever project is shown", async () => {
        const refusal = await admin.tracesV2
          .spanTree({
            projectId: aggregate.id,
            traceId: traceIdOf("outsider"),
            tenantId: outsider.id,
          })
          .then(() => null)
          .catch((error: unknown) => error);

        expect(handledCodeOf(refusal)).toBe("trace_not_found");
      });

      it("finds the member from the proof when no member is named", async () => {
        const header = await admin.tracesV2.header({
          projectId: aggregate.id,
          traceId: traceIdOf("seller"),
          full: false,
        });
        const spans = await admin.tracesV2.spanTree({
          projectId: aggregate.id,
          traceId: traceIdOf("seller"),
        });

        expect(header.projectId).toBe(memberId("seller"));
        expect(spans.map((span) => span.name)).toEqual([
          `span of ${memberId("seller")}`,
        ]);
      });
    });
  });

  describe("given a member trace that an online evaluation already scored", () => {
    describe("when ana opens that trace from the aggregate", () => {
      it("shows the owner's evaluation and runs none from the aggregate", async () => {
        const evaluations = await admin.tracesV2.evals({
          projectId: aggregate.id,
          traceId: traceIdOf("engineer"),
          tenantId: memberId("engineer"),
        });
        const listed = (await listAggregate()).items.find(
          (item) => item.traceId === traceIdOf("engineer"),
        );

        expect(evaluations.map((run) => run.evaluatorId)).toEqual([
          "monitor-of-engineer",
        ]);
        expect(listed?.evaluations.map((run) => run.evaluatorId)).toEqual([
          "monitor-of-engineer",
        ]);
        const aggregateRuns = await ch.query({
          query:
            "SELECT count() AS runs FROM evaluation_runs WHERE TenantId = {tenantId:String}",
          query_params: { tenantId: aggregate.id },
          format: "JSONEachRow",
        });
        const [counted] = await aggregateRuns.json<{ runs: string | number }>();
        expect(Number(counted?.runs)).toBe(0);
      });
    });
  });

  describe("given a member trace that an online evaluation already scored", () => {
    describe("when ana opens the drawer's evaluations panel from the aggregate", () => {
      /** @scenario "The owner's existing evaluation results show on a member trace" */
      it("shows the owner's evaluation through the route the panel calls", async () => {
        const evaluations = await admin.traces.getEvaluations({
          projectId: aggregate.id,
          traceId: traceIdOf("engineer"),
          tenantId: memberId("engineer"),
        });

        expect(evaluations?.map((run) => run.evaluator_id)).toEqual([
          "monitor-of-engineer",
        ]);
      });

      it("finds the member from the proof when no member is named", async () => {
        const evaluations = await admin.traces.getEvaluations({
          projectId: aggregate.id,
          traceId: traceIdOf("engineer"),
        });

        expect(evaluations?.map((run) => run.evaluator_id)).toEqual([
          "monitor-of-engineer",
        ]);
      });

      it("reads the inputs an evaluation recorded under the member", async () => {
        const inputs = await admin.traces.getEvaluationInputs({
          projectId: aggregate.id,
          evaluationId: engineerEvaluationId,
          tenantId: memberId("engineer"),
        });

        expect(inputs).toEqual({
          input: `question of ${memberId("engineer")}`,
        });
      });

      it("refuses a member the proof does not read", async () => {
        const refusal = await admin.traces
          .getEvaluations({
            projectId: aggregate.id,
            traceId: traceIdOf("outsider"),
            tenantId: outsider.id,
          })
          .then(() => null)
          .catch((error: unknown) => error);

        expect(handledCodeOf(refusal)).toBe("trace_not_found");
      });
    });
  });

  describe("given an aggregate whose two members each hold a trace with the same id", () => {
    describe("when ana opens it from the second member's row", () => {
      /** @scenario "A trace id held by two members opens the member it was listed under" */
      it("reads the header, the spans and the evaluations from that member alone", async () => {
        const rows = (await listAggregate()).items.filter(
          (item) => item.traceId === TWIN_TRACE,
        );
        expect(rows.map((row) => row.projectId).sort()).toEqual(
          [memberId("engineer"), memberId("seller")].sort(),
        );
        const sellerRow = rows.find(
          (row) => row.projectId === memberId("seller"),
        );
        if (!sellerRow) throw new Error("the seller's twin row is not listed");
        const args = {
          projectId: aggregate.id,
          traceId: TWIN_TRACE,
          occurredAtMs: sellerRow.timestamp,
          tenantId: sellerRow.projectId,
        };

        const header = await admin.tracesV2.header({ ...args, full: false });
        const spans = await admin.tracesV2.spanTree(args);
        const evaluations = await admin.tracesV2.evals(args);

        expect(header.projectId).toBe(memberId("seller"));
        expect(header.input).toBe(`input of ${memberId("seller")}`);
        expect(spans.map((span) => span.name)).toEqual([
          `span of ${memberId("seller")}`,
        ]);
        expect(evaluations.map((run) => run.evaluatorId)).toEqual([
          "monitor-of-seller",
        ]);
        expect(sellerRow.evaluations.map((run) => run.evaluatorId)).toEqual([
          "monitor-of-seller",
        ]);
      });
    });

    describe("when ana opens it with no member named", () => {
      it("picks the same member on every read behind the drawer", async () => {
        const args = { projectId: aggregate.id, traceId: TWIN_TRACE };

        const header = await admin.tracesV2.header({ ...args, full: false });
        const spans = await admin.tracesV2.spanTree(args);
        const evaluations = await admin.tracesV2.evals(args);
        const again = await admin.tracesV2.header({ ...args, full: false });

        const picked = header.projectId;
        expect([memberId("engineer"), memberId("seller")]).toContain(picked);
        expect(again.projectId).toBe(picked);
        expect(spans.map((span) => span.name)).toEqual([`span of ${picked}`]);
        expect(evaluations.map((run) => run.evaluatorId)).toEqual([
          picked === memberId("seller")
            ? "monitor-of-seller"
            : "monitor-of-engineer",
        ]);
      });
    });
  });
});
