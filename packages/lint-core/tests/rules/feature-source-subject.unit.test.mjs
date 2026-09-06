import { afterAll, describe, expect, it } from "vitest";
import { featureSourceSubjectRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { layoutVersion: 0, roles: { server: {} } },
    project: { layoutVersion: 0, roles: { server: {} } },
  },
  catalogue: { project: ["project"] },
});

afterAll(() => workspace.cleanup());

function report(filename) {
  return runRule(featureSourceSubjectRule, {
    code: "export const x = 1;",
    cwd: workspace.cwd,
    filename,
  });
}

describe("given a strict feature source file claiming another feature's subject", () => {
  describe("when the claimed subject belongs to a different singular feature", () => {
    /** @scenario "A foreign subject claim is reported with its owning feature and a move fix" */
    it("reports foreignSubject naming the owner and the move fix", () => {
      const found = report("packages/features/agent/server/src/services/project.service.ts");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("foreignSubject");
      expect(found[0].data).toEqual({
        path: "services/project.service.ts",
        subject: "project",
        owner: "project",
      });
      expect(found[0].message).toContain("packages/features/project/");
      expect(found[0].message).toContain("feature-move");
    });
  });

  describe("when the claimed subject belongs to the file's own feature", () => {
    /** @scenario "A file claiming its own subject is left alone" */
    it("reports nothing", () => {
      expect(report("packages/features/agent/server/src/services/agent.service.ts")).toEqual([]);
    });
  });
});
