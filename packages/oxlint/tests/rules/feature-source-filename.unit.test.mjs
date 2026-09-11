import { afterAll, describe, expect, it } from "vitest";
import { featureSourceFilenameRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
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
      const found = report("modules/agent/server/src/services/AgentService.service.ts");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("filename");
      expect(found[0].data.name).toBe("AgentService.service.ts");
      expect(found[0].data.artifacts).toContain("service");
    });
  });

  describe("when the filename is already lower kebab case", () => {
    /** @scenario "A correctly named strict source file is left alone" */
    it("reports nothing", () => {
      expect(report("modules/agent/server/src/services/agent.service.ts")).toEqual([]);
    });
  });
});
