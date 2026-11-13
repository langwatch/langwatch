import { afterAll, describe, expect, it } from "vitest";

import {
  BRAID_HONOUR_OWNER,
  spanBraidHonourOwnerRule,
} from "../../src/rules/span-braid-honour-owner.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { trace: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(spanBraidHonourOwnerRule, { code, cwd: workspace.cwd, filename });
}

const IMPORT = 'import { honourSpanBraids } from "@langwatch/authorization";';
const SERVICE = "modules/trace/process/src/services/trace-list.service.ts";

describe("given production code outside the braid pause", () => {
  describe("when it imports honourSpanBraids", () => {
    /** @scenario "Honouring braids outside the trace module's braid pause is reported" */
    it("reports honourOutsidePause naming the function and the file", () => {
      const found = report(IMPORT, SERVICE);

      expect(found.map((finding) => [finding.messageId, finding.data])).toEqual([
        ["honourOutsidePause", { name: "honourSpanBraids", path: SERVICE }],
      ]);
    });
  });

  describe("when it calls honourSpanBraids through a namespace import", () => {
    /** @scenario "Honouring braids outside the trace module's braid pause is reported" */
    it("reports the member access, and nothing for the same name on another object", () => {
      const found = report(
        'import * as authz from "@langwatch/authorization";\n' +
          "const proof = authz.honourSpanBraids({ authorization });\n" +
          "const other = plans.honourSpanBraids;",
        SERVICE,
      );

      expect(found.map((finding) => finding.messageId)).toEqual(["honourOutsidePause"]);
    });
  });

  describe("when it writes braidsHonoured on an object literal", () => {
    /** @scenario "Setting the braids-honoured flag by hand is reported" */
    it("reports flagByHand", () => {
      const found = report(
        "const forged = sealAuthorization({ ...authorization, braidsHonoured: true });",
        SERVICE,
      );

      expect(found.map((finding) => [finding.messageId, finding.data.name])).toEqual([
        ["flagByHand", "braidsHonoured"],
      ]);
    });

    it("reports nothing for reading the flag", () => {
      expect(
        report(
          "const { braidsHonoured } = authorization;\nconst on = authorization.braidsHonoured;",
          SERVICE,
        ),
      ).toEqual([]);
    });
  });
});

describe("given the braid pause service", () => {
  describe("when it imports honourSpanBraids", () => {
    /** @scenario "The trace module's braid pause may honour braids" */
    it("reports nothing", () => {
      expect(report(IMPORT, BRAID_HONOUR_OWNER)).toEqual([]);
    });
  });

  describe("when it writes braidsHonoured by hand", () => {
    it("still reports flagByHand", () => {
      expect(
        report("const proof = { braidsHonoured: true };", BRAID_HONOUR_OWNER).map(
          (finding) => finding.messageId,
        ),
      ).toEqual(["flagByHand"]);
    });
  });
});

describe("given the authorization package or a test", () => {
  describe("when it declares, sets or imports the honour", () => {
    /** @scenario "The trace module's braid pause may honour braids" */
    it("reports nothing", () => {
      const declares =
        "export function honourSpanBraids({ authorization }) {\n" +
        "  return sealAuthorization({ ...authorization, braidsHonoured: true });\n}";

      expect(report(declares, "packages/authorization/src/authorization.ts")).toEqual([]);
      expect(
        report(IMPORT, "modules/trace/process/src/__tests__/support/proofs.fixture.ts"),
      ).toEqual([]);
    });
  });
});
