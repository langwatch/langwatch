import { afterAll, describe, expect, it } from "vitest";

import { accessEscapeKindRule } from "../../src/rules/access-escape-kind.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/agent/process/src/transport/agent.rest.ts";

function report(code) {
  return runRule(accessEscapeKindRule, { code, cwd: workspace.cwd, filename: TRANSPORT });
}

describe("given a module transport", () => {
  describe("when a route opens its door with an escape kind", () => {
    /** @scenario "An escape-kind access declaration is reported" */
    it("reports escapeKind when the reason is missing or blank", () => {
      const found = report(
        "route.withAccess(publicRoute({}));\n" +
          'route.serviceAuthorized({ reason: "  ", permissions: [] });\n' +
          "route.noPermission();",
      );

      expect(found.map((finding) => [finding.messageId, finding.data.name])).toEqual([
        ["escapeKind", "publicRoute"],
        ["escapeKind", "serviceAuthorized"],
        ["escapeKind", "noPermission"],
      ]);
    });
  });

  describe("when an escape kind states a reason", () => {
    /** @scenario "An escape kind with a reason is accepted" */
    it("reports nothing, whatever the wording", () => {
      expect(
        report(
          'route.withAccess(publicRoute({ reason: "x" }));\n' +
            "route.noPermission(OWN_OFFER_ONLY);\n" +
            "route.serviceAuthorized({ ...DECLARED });",
        ),
      ).toEqual([]);
    });
  });

  describe("when a handler asks admitX beside its operation", () => {
    /** @scenario "A handler pairing admitX with an operation is reported" */
    it("reports admitInHandler", () => {
      const found = report(
        "route.handle(async ({ app, actor }) => {\n" +
          "  await app.admitOperator(actor);\n" +
          "  return app.listThings();\n" +
          "});",
      );

      expect(found.map((finding) => [finding.messageId, finding.data.name])).toEqual([
        ["admitInHandler", "admitOperator"],
      ]);
    });
  });

  describe("when the handler answers with the admitX operation itself", () => {
    /** @scenario "A handler answering with an admitX operation is accepted" */
    it("reports nothing", () => {
      expect(
        report(
          "route.handle(({ app, actor }) => app.door().admitAutomatically({ userId: actor.id }));\n" +
            "route.handle(async ({ app }) => {\n  return await app.admitOperator();\n});",
        ),
      ).toEqual([]);
    });
  });

  describe("when a route names its permission", () => {
    /** @scenario "A route with a named permission is accepted" */
    it("reports nothing", () => {
      expect(
        report('route.withPermission("agent:view").handle(({ app }) => app.listThings());'),
      ).toEqual([]);
    });
  });
});
