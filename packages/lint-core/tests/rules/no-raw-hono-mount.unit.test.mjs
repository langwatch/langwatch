import { afterAll, describe, expect, it } from "vitest";
import { noRawHonoMountRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code) {
  return runRule(noRawHonoMountRule, {
    code,
    cwd: workspace.cwd,
    filename: "apps/api/src/app.ts",
  });
}

describe("given an application or package source file", () => {
  describe("when it registers a verb on the raw Hono app", () => {
    /** @scenario "A raw Hono mount is reported" */
    it("reports rawMount", () => {
      const found = report('app.hono.get("/x", handler);');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("rawMount");
    });
  });

  describe("when it mounts through the access policy", () => {
    /** @scenario "Mounting through app.access is left alone" */
    it("reports nothing", () => {
      expect(report('app.access(policy).get("/x", handler);')).toEqual([]);
    });
  });
});
