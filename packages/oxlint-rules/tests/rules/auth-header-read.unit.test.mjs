import { afterAll, describe, expect, it } from "vitest";

import { authHeaderReadRule } from "../../src/rules/auth-header-read.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(authHeaderReadRule, { code, cwd: workspace.cwd, filename });
}

const READ = 'const token = request.headers.get("X-Auth-Token");';

describe("given a module transport, app or module file", () => {
  describe("when it reads an auth header", () => {
    /** @scenario "An auth header read in a transport is reported" */
    it("reports authHeader with the lower-cased header", () => {
      const found = report(READ, "modules/agent/process/src/transport/agent.rest.ts");

      expect(found.map((finding) => [finding.messageId, finding.data.header])).toEqual([
        ["authHeader", "x-auth-token"],
      ]);
    });

    /** @scenario "An auth header read in a module file is reported" */
    it("reports the read in the module file", () => {
      expect(report(READ, "modules/agent/process/src/agent.module.ts")).toHaveLength(1);
    });
  });

  describe("when the header only appears as a type literal", () => {
    /** @scenario "An auth header named in a type is not this rule's business" */
    it("reports nothing", () => {
      expect(
        report(
          'type Reason = "authorization" | "expired";',
          "modules/agent/process/src/app/agent.app.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a module service", () => {
  describe("when it names an auth header", () => {
    /** @scenario "A service naming an auth header is not this rule's business" */
    it("reports nothing", () => {
      expect(report(READ, "modules/agent/process/src/services/agent.service.ts")).toEqual([]);
    });
  });
});
