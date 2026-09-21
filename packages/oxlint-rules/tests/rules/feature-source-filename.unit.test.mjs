import { afterAll, describe, expect, it } from "vitest";
import { featureSourceFilenameRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(filename) {
  return runRule(featureSourceFilenameRule, {
    code: "export const x = 1;",
    cwd: workspace.cwd,
    filename,
  });
}

describe("given a strict feature source file", () => {
  describe("when the filename is not lower kebab case", () => {
    /** @scenario "A misnamed strict source file is reported with the allowed artifacts" */
    it("reports filename naming the file and the allowed artifacts", () => {
      const found = report("modules/agent/process/src/services/AgentService.service.ts");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("filename");
      expect(found[0].data.name).toBe("AgentService.service.ts");
      expect(found[0].data.artifacts).toContain("service");
    });

    /** @scenario "A misnamed strict source file names the exact renamed target" */
    it("computes the exact kebab-case target, stripping a redundant artifact word", () => {
      const found = report("modules/agent/process/src/services/AgentService.service.ts");

      expect(found[0].message).toContain("Rename the file to `agent.service.ts`");
    });

    /** @scenario "A filename with no recognizable artifact falls back to the closed list" */
    it("falls back to the artifact list when no artifact can be inferred", () => {
      const found = report("modules/agent/process/src/services/AgentHelper.ts");

      expect(found[0].message).toContain("picking one artifact from");
    });
  });

  describe("when a server filename hyphenates its architectural qualifier", () => {
    /** @scenario "A qualifier-prefixed server filename names the dot-separated rename" */
    it("names the exact dot-separated rename instead of a folder move", () => {
      const found = report("modules/agent/process/src/repositories/prisma-agent.repository.ts");

      expect(found).toHaveLength(1);
      expect(found[0].message).toContain("Rename the file to `prisma.agent.repository.ts`");
    });
  });

  describe("when the filename is already lower kebab case", () => {
    /** @scenario "A correctly named strict source file is left alone" */
    it("reports nothing", () => {
      expect(report("modules/agent/process/src/services/agent.service.ts")).toEqual([]);
    });
  });
});
