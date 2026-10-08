import { afterAll, describe, expect, it } from "vitest";

import { credentialReaderOwnerRule } from "../../src/rules/credential-reader-owner.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(credentialReaderOwnerRule, { code, cwd: workspace.cwd, filename });
}

describe("given a module outside the credential owners", () => {
  describe("when it imports a credential reader", () => {
    /** @scenario "A credential reader imported by a module is reported" */
    it("reports credentialReader naming the reader", () => {
      const found = report(
        'import { projectCredentialOfRequest } from "@langwatch/api/rest";',
        "modules/agent/process/src/agent.module.ts",
      );

      expect(found.map((finding) => [finding.messageId, finding.data.name])).toEqual([
        ["credentialReader", "projectCredentialOfRequest"],
      ]);
    });
  });

  describe("when it declares its own bearer extractor", () => {
    /** @scenario "A hand-written bearer extractor is reported" */
    it("reports the declaration", () => {
      const found = report(
        "const extractBearerToken = (header) => header;",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found.map((finding) => finding.data.name)).toEqual(["extractBearerToken"]);
    });
  });
});

describe("given a credential owner", () => {
  describe("when packages/api declares a credential reader", () => {
    /** @scenario "The door's own package may read credentials" */
    it("reports nothing", () => {
      expect(
        report(
          "export function projectCredentialOfRequest(request) { return request; }",
          "packages/api/src/rest/credential.ts",
        ),
      ).toEqual([]);
    });
  });
});
