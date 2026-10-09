/**
 * @vitest-environment node
 * `graphs.create` and `graphs.updateById` on the real tRPC runtime: the graph
 * travels as JSON text and the door parses it (rulings 2026-10-06, round 7, Q39).
 * Spec: packages/api/specs/transient-refusals.feature.
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { graphTrpcTransport } from "../graph.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const GRAPH = { graphType: "line", series: [{ name: "p95" }] };

function mounted() {
  const app = createDashboardTestApp();
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: () => true }),
  })
    .mount(graphTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });

  return { app, caller };
}

describe("given the graphs tRPC namespace on the real runtime", () => {
  describe("when a graph is created with its definition as JSON text", () => {
    /** @scenario "A malformed graph JSON is a 400 schema issue" */
    it("stores the parsed record and reads it back", async () => {
      const { caller } = mounted();

      const created = await caller.create({
        projectId: PROJECT_ID,
        name: "Latency",
        graph: JSON.stringify(GRAPH),
      });

      await expect(caller.getAll({ projectId: PROJECT_ID })).resolves.toEqual([
        expect.objectContaining({ id: created.id, graph: GRAPH }),
      ]);
    });
  });

  describe.each(["{not json", "[1]"])("when the graph text is %s", (text) => {
    /** @scenario "A malformed graph JSON is a 400 schema issue" */
    it("refuses create with BAD_REQUEST on the graph field and stores nothing", async () => {
      const { caller } = mounted();

      await expect(
        caller.create({ projectId: PROJECT_ID, name: "Latency", graph: text }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { issues: [expect.objectContaining({ path: ["graph"] })] },
      });
      await expect(caller.getAll({ projectId: PROJECT_ID })).resolves.toEqual([]);
    });

    /** @scenario "A malformed graph JSON is a 400 schema issue" */
    it("refuses updateById with BAD_REQUEST on the graph field and keeps the stored graph", async () => {
      const { caller } = mounted();
      const created = await caller.create({
        projectId: PROJECT_ID,
        name: "Latency",
        graph: JSON.stringify(GRAPH),
      });

      await expect(
        caller.updateById({
          projectId: PROJECT_ID,
          graphId: created.id,
          name: "Latency",
          graph: text,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { issues: [expect.objectContaining({ path: ["graph"] })] },
      });
      await expect(caller.getAll({ projectId: PROJECT_ID })).resolves.toEqual([
        expect.objectContaining({ id: created.id, graph: GRAPH }),
      ]);
    });
  });
});
