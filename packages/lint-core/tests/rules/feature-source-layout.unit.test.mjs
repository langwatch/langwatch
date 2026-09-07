import { afterAll, describe, expect, it } from "vitest";
import { featureSourceLayoutRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(filename, code = "export const x = 1;") {
  return runRule(featureSourceLayoutRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature contract module", () => {
  describe("when it names only the artifact and not the subject", () => {
    /** @scenario "A contract artifact missing its subject is reported" */
    it("reports contractMissingSubject with the artifact", () => {
      const found = report("packages/features/agent/contract/src/commands.ts");

      expect(found.map((e) => e.messageId)).toEqual(["contractMissingSubject"]);
      expect(found[0].data).toEqual({ name: "commands.ts", artifact: "commands" });
    });
  });

  describe("when it names a server-only artifact", () => {
    /** @scenario "A server-only artifact in contract source is reported" */
    it("reports contractServerArtifact", () => {
      const found = report("packages/features/agent/contract/src/agent.repository.ts");

      expect(found.map((e) => e.messageId)).toEqual(["contractServerArtifact"]);
    });
  });
});

describe("given a strict feature server module", () => {
  describe("when a service filename ends in -process.service.ts", () => {
    /** @scenario "A process manager named as a service is reported" */
    it("reports processManagerService", () => {
      const found = report("packages/features/agent/server/src/services/agent-process.service.ts");

      expect(found.map((e) => e.messageId)).toEqual(["processManagerService"]);
    });
  });

  describe("when a rules module constructs a class", () => {
    /** @scenario "A rules module constructing a class is reported" */
    it("reports rulesImpurity naming the class", () => {
      const found = report(
        "packages/features/agent/server/src/rules/agent.rules.ts",
        "export class Helper {} export const x = new Helper();",
      );

      expect(found.map((e) => e.messageId)).toEqual(["rulesImpurity"]);
      expect(found[0].data.found).toBe("a class");
    });
  });

  describe("when a source path has no home in layout v0", () => {
    /** @scenario "A path with no strict layout home is reported with the allowed homes" */
    it("reports serverPath listing the allowed directories", () => {
      const found = report("packages/features/agent/server/src/misc/agent.helper.ts");

      expect(found.map((e) => e.messageId)).toEqual(["serverPath"]);
      expect(found[0].message).toContain("services/");
      expect(found[0].message).toContain("transport/<surface>/");
    });
  });

  describe("when the path matches a recognized server pattern", () => {
    /** @scenario "A recognized strict server path is left alone" */
    it("reports nothing", () => {
      expect(report("packages/features/agent/server/src/services/agent.service.ts")).toEqual([]);
    });
  });
});

it("accepts the canonical feature API contract", () => {
  expect(report("packages/features/agent/contract/src/agent.api.ts")).toEqual([]);
});

it.each([
  "packages/features/agent/contract/src/other.api.ts",
  "packages/features/agent/contract/src/nested/agent.api.ts",
])("keeps noncanonical API modules out of contracts: %s", (file) => {
  expect(report(file).map((entry) => entry.messageId)).toEqual(["contractServerArtifact"]);
});
