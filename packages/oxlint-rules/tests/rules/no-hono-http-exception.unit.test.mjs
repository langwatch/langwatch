import { afterAll, describe, expect, it } from "vitest";

import { noHonoHttpExceptionRule } from "../../src/rules/no-hono-http-exception.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/agent/process/src/transport/agent.rest.ts";

function messageIds(code, filename = TRANSPORT) {
  return runRule(noHonoHttpExceptionRule, { code, cwd: workspace.cwd, filename }).map(
    (finding) => finding.messageId,
  );
}

describe("given a module transport", () => {
  describe("when it imports hono/http-exception", () => {
    /** @scenario "A module importing hono/http-exception is reported" */
    it("reports honoException", () => {
      expect(messageIds('import { HTTPException } from "hono/http-exception";')).toEqual([
        "honoException",
      ]);
    });
  });

  describe("when it imports from hono itself", () => {
    /** @scenario "A module importing hono without its exception is accepted" */
    it("reports nothing", () => {
      expect(messageIds('import type { Context } from "hono";')).toEqual([]);
    });
  });
});

describe("given a file outside any module", () => {
  describe("when it imports hono/http-exception", () => {
    /** @scenario "The framework importing hono/http-exception is not this rule's business" */
    it("reports nothing", () => {
      expect(
        messageIds(
          'import { HTTPException } from "hono/http-exception";',
          "packages/api/src/rest/request.ts",
        ),
      ).toEqual([]);
    });
  });
});
