import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetBaselineCache } from "../../src/baseline.mjs";
import { prismaCountInListQueryRule } from "../../src/rules/prisma-count-in-list-query.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());
afterEach(() => resetBaselineCache());

const REPOSITORY = "modules/agent/server/src/repositories/prisma/agent.repository.ts";
const SERVICE = "modules/agent/server/src/services/agent.service.ts";

function report(code, filename = REPOSITORY) {
  return runRule(prismaCountInListQueryRule, { code, cwd: workspace.cwd, filename });
}

describe("given a Prisma repository seam file", () => {
  describe("when a findMany includes a relation _count", () => {
    /** @scenario "A count include on a findMany list query is reported" */
    it("reports countInsideFindMany at the _count property", () => {
      const found = report(
        "class AgentRepository {\n" +
          "  findMany() {\n" +
          "    return this.client.agent.findMany({\n" +
          "      where: { active: true },\n" +
          "      include: { _count: true },\n" +
          "    });\n" +
          "  }\n" +
          "}",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("countInsideFindMany");
      expect(found[0].message).toBe(
        "`_count` rides this `findMany`, and the planner can re-run its aggregate once per listed row." +
          " Drop `_count` from the query and run a second `groupBy` count restricted to the listed row ids.",
      );
    });
  });

  describe("when a findMany reaches _count through a nested select", () => {
    it("reports countInsideFindMany", () => {
      const found = report(
        "class AgentRepository {\n" +
          "  findMany() {\n" +
          "    return this.client.agent.findMany({\n" +
          "      select: {\n" +
          "        id: true,\n" +
          "        posts: { select: { _count: true } },\n" +
          "      },\n" +
          "    });\n" +
          "  }\n" +
          "}",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("countInsideFindMany");
    });
  });

  describe("when _count sits inside a findUnique", () => {
    /** @scenario "A count on a single-row query is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "class AgentRepository {\n" +
            "  findById(id) {\n" +
            "    return this.client.agent.findUnique({\n" +
            "      where: { id },\n" +
            "      include: { _count: true },\n" +
            "    });\n" +
            "  }\n" +
            "}",
        ),
      ).toEqual([]);
    });
  });

  describe("when _count orders a findMany's results instead of being included", () => {
    /** @scenario "Count ordering is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "class AgentRepository {\n" +
            "  findMany() {\n" +
            "    return this.client.agent.findMany({\n" +
            "      orderBy: { posts: { _count: \"desc\" } },\n" +
            "    });\n" +
            "  }\n" +
            "}",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a file outside the Prisma seam", () => {
  it("reports nothing for the identical findMany shape", () => {
    const found = report(
      "class AgentService {\n" +
        "  findMany() {\n" +
        "    return this.client.agent.findMany({\n" +
        "      include: { _count: true },\n" +
        "    });\n" +
        "  }\n" +
        "}",
      SERVICE,
    );

    expect(found).toEqual([]);
  });
});

describe("given a file baselined for prisma-count-in-list-query", () => {
  it("reports nothing even though its findMany includes a relation _count", () => {
    workspace.write(
      "packages/architecture-enforcer/src/oxlint-baseline.json",
      JSON.stringify({
        version: 0,
        entries: [{ key: `prisma-count-in-list-query|${REPOSITORY}`, measured: "2026-09-15" }],
      }),
    );
    resetBaselineCache();

    expect(
      report(
        "class AgentRepository {\n" +
          "  findMany() {\n" +
          "    return this.client.agent.findMany({\n" +
          "      include: { _count: true },\n" +
          "    });\n" +
          "  }\n" +
          "}",
      ),
    ).toEqual([]);
  });
});
