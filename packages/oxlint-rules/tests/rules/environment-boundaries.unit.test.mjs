import { afterAll, describe, expect, it } from "vitest";

import { environmentBoundariesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(environmentBoundariesRule, { code, cwd: workspace.cwd, filename });
}

describe("given a reusable package", () => {
  describe("when it reads process.env", () => {
    /** @scenario "Reading process.env outside a composition root is reported" */
    it("reports environment with the fix", () => {
      const found = report(
        "export const url = process.env.DATABASE_URL;",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("environment");
      expect(found[0].line).toBe(1);
      expect(found[0].message).toContain("Declare the key in the module's config schema");
      expect(found[0].message).not.toMatch(/platform\/config|composition\.ts/);
    });
  });

  describe("when the file is an application's main.ts or config.ts", () => {
    /** @scenario "An application's main.ts or config.ts may read process.env" */
    it.each(["apps/api/src/main.ts", "apps/tasks/src/config.ts"])(
      "reports nothing for %s",
      (file) => {
        expect(report("export const url = process.env.DATABASE_URL;", file)).toEqual([]);
      },
    );
  });

  describe("when an application file is neither main.ts nor config.ts", () => {
    /** @scenario "Any other application file reading process.env is reported" */
    it.each(["apps/api/src/platform/config/env.composition.ts", "apps/worker/src/boot/start.ts"])(
      "reports environment for %s",
      (file) => {
        const found = report("export const url = process.env.DATABASE_URL;", file);

        expect(found.map((finding) => finding.messageId)).toEqual(["environment"]);
      },
    );
  });

  describe("when the file belongs to the published npx CLI", () => {
    /** @scenario "The published CLI may read process.env" */
    it("reports nothing", () => {
      expect(
        report("export const key = process.env.LANGWATCH_API_KEY;", "apps/server/src/cli.ts"),
      ).toEqual([]);
    });
  });

  describe("when the file belongs to the secrets package", () => {
    /** @scenario "The secrets package may read process.env" */
    it("reports nothing", () => {
      expect(
        report("export const key = process.env.NEXTAUTH_SECRET;", "packages/secrets/src/chain.ts"),
      ).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "A test file may read process.env" */
    it("reports nothing", () => {
      expect(
        report(
          "export const url = process.env.DATABASE_URL;",
          "modules/agent/process/src/services/agent.service.test.ts",
        ),
      ).toEqual([]);
    });
  });
});
