import { afterAll, describe, expect, it } from "vitest";

import { featureSourceSubjectRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const catalogue = {
  version: 0,
  features: [
    { id: "agent", root: "modules/agent", subjects: ["agent"] },
    { id: "project", root: "modules/project", subjects: ["project"] },
    { id: "sso", root: "enterprise/modules/sso", subjects: ["sso-connection"] },
    { id: "planned", root: "modules/planned", subjects: ["planned"] },
  ],
};

const workspace = createFixtureWorkspace({
  features: { agent: { roles: { process: {} } }, project: { roles: { process: {} } } },
  files: {
    "modules/catalogue.json": JSON.stringify(catalogue),
    "enterprise/modules/sso/process/package.json": "{}",
  },
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
      const found = report("modules/agent/process/src/services/project.service.ts");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("foreignSubject");
      expect(found[0].data).toEqual({
        path: "services/project.service.ts",
        subject: "project",
        owner: "project",
        ownerRoot: "modules/project",
        role: "process",
      });
      expect(found[0].line).toBe(1);
      expect(found[0].message).toContain("modules/project/process/src/services/project.service.ts");
      expect(found[0].message).not.toContain("skill");
    });

    /** @scenario "A foreign subject claim is reported with its owning feature and a move fix" */
    it("moves the file under the owner's catalogue root, enterprise included", () => {
      const found = report("modules/agent/process/src/repositories/sso-connection.repository.ts");

      expect(found.map((finding) => finding.data.ownerRoot)).toEqual(["enterprise/modules/sso"]);
      expect(found[0].message).toContain(
        "enterprise/modules/sso/process/src/repositories/sso-connection.repository.ts",
      );
    });
  });

  describe("when the owning catalogue entry's root is not on disk yet", () => {
    /** @scenario "A subject whose owner is not in the tree yet is left alone" */
    it("reports nothing", () => {
      expect(report("modules/agent/process/src/services/planned.service.ts")).toEqual([]);
    });
  });

  describe("when the claimed subject belongs to the file's own feature", () => {
    /** @scenario "A file claiming its own subject is left alone" */
    it("reports nothing", () => {
      expect(report("modules/agent/process/src/services/agent.service.ts")).toEqual([]);
    });
  });
});
