import { afterAll, describe, expect, it } from "vitest";

import { noHandRolledPlanGateRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { role: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noHandRolledPlanGateRule, { code, cwd: workspace.cwd, filename });
}

const APP = "modules/role/process/src/app/role.app.ts";

describe("given a module's process package", () => {
  describe("when the application throws the plan refusal itself", () => {
    /** @scenario "A plan refusal thrown in the application is reported" */
    it("reports handRolledPlanGate and names the declaration to use", () => {
      const found = report('throw new EnterprisePlanRequiredError("RBAC");', APP);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("handRolledPlanGate");
      expect(found[0].message).toBe(
        "`new EnterprisePlanRequiredError(...)` refuses a plan in" +
          " `modules/role/process/src/app/role.app.ts`, in the app or transport layer. The framework asks a declared plan gate after access, so a caller without permission never learns the plan's limits." +
          ' Declare `.withEntitlement("enterprise", { feature, when })` on the route or' +
          " procedure and delete this refusal; a gate that needs loaded data belongs in a" +
          " service method." +
          " Read the `module-dependencies` skill.",
      );
    });
  });

  describe("when the application refuses through the contract's assertion helpers", () => {
    /** @scenario "The contract's plan assertions are refusals too" */
    it("reports assertEnterprisePlanType and assertEnterprisePlan", () => {
      const found = report(
        "assertEnterprisePlanType({ planType, errorMessage });\n" +
          "await assertEnterprisePlan({ planProvider, organizationId, errorMessage });",
        APP,
      );

      expect(found.map((finding) => [finding.data.refusal, finding.line])).toEqual([
        ["assertEnterprisePlanType(...)", 1],
        ["assertEnterprisePlan(...)", 2],
      ]);
    });
  });

  describe("when an enterprise module's application throws it", () => {
    /** @scenario "A plan refusal in an enterprise process package is reported" */
    it("reports it", () => {
      const found = report(
        'throw new EnterprisePlanRequiredError("SSO");',
        "enterprise/modules/sso/process/src/app/sso.app.ts",
      );

      expect(found).toHaveLength(1);
    });
  });

  describe("when the code only names the error or reads a plan", () => {
    /** @scenario "Naming the refusal or reading the plan is not a refusal" */
    it("reports nothing for a type position, a catch and a plan read", () => {
      const found = report(
        "if (error instanceof EnterprisePlanRequiredError) return;\n" +
          "const plan = await entitlements.getActivePlan({ organizationId });",
        APP,
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a transport declaration", () => {
  describe("when it throws the plan refusal", () => {
    /** @scenario "A plan refusal thrown in a transport declaration is reported" */
    it("reports it", () => {
      const found = report(
        'throw new EnterprisePlanRequiredError("RBAC");',
        "modules/role/process/src/transport/role.rest.ts",
      );

      expect(found).toHaveLength(1);
    });
  });
});

describe("given a service", () => {
  describe("when it refuses a plan on data it loaded", () => {
    /** @scenario "A plan refusal in a service is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'throw new EnterprisePlanRequiredError("RBAC");\nassertEnterprisePlanType({ planType });',
        "modules/role/process/src/services/role.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a test file", () => {
  describe("when it builds the plan refusal", () => {
    /** @scenario "A test file may build the refusal" */
    it("reports nothing", () => {
      const found = report(
        'new EnterprisePlanRequiredError("RBAC");',
        "modules/role/process/src/app/__tests__/role.app.unit.test.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
