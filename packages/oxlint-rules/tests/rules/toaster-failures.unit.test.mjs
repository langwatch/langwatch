import { afterAll, describe, expect, it } from "vitest";

import { noFailureOnToasterRule } from "../../src/rules/no-failure-on-toaster.rule.mjs";
import { noModuleToasterRule } from "../../src/rules/no-module-toaster.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { layoutVersion: 0, roles: { browser: {}, process: {} } },
  },
});

afterAll(() => workspace.cleanup());

const BROWSER = "modules/agent/browser/src/ui/panel.tsx";
const IMPORT = 'import { toaster } from "@langwatch/design-system/toaster";\n';

function failures(code, filename = BROWSER) {
  return runRule(noFailureOnToasterRule, { code, cwd: workspace.cwd, filename });
}

function moduleToasters(code, filename = BROWSER) {
  return runRule(noModuleToasterRule, { code, cwd: workspace.cwd, filename });
}

describe("no-failure-on-toaster", () => {
  describe("when a feature-web file raises a failure on the Design System toaster", () => {
    /** @scenario "A failure raised on the Design System toaster is reported" */
    it.each([
      [
        "a create with an error type",
        `${IMPORT}toaster.create({ title: "Couldn't save", type: "error" });`,
      ],
      ["the error method", `${IMPORT}toaster.error({ title: "Couldn't save" });`],
      [
        "an aliased import",
        'import { toaster as appToaster } from "@langwatch/design-system/toaster";\nappToaster.error({ title: "x" });',
      ],
      [
        "a builder the call never sees",
        `${IMPORT}const build = () => ({ title: "x", type: "error" as const });\ntoaster.create(build());`,
      ],
    ])("reports %s", (_shape, code) => {
      expect(failures(code).map((finding) => finding.messageId)).toEqual(["failureOnToaster"]);
    });
  });

  describe("when the failure is reached through a namespace import or a const type", () => {
    /** @scenario "A failure reached through a namespace import or a const type is reported" */
    it.each([
      [
        "a namespace import",
        'import * as ds from "@langwatch/design-system/toaster";\nds.toaster.error({ title: "x" });',
      ],
      ["a const type", `${IMPORT}const type = "error";\ntoaster.create({ title: "x", type });`],
      [
        "a namespace import with a const type",
        'import * as ds from "@langwatch/design-system/toaster";\nconst kind = "error" as const;\nds.toaster.create({ title: "x", type: kind });',
      ],
    ])("reports %s", (_shape, code) => {
      expect(failures(code).map((finding) => finding.messageId)).toEqual(["failureOnToaster"]);
    });

    it("accepts a const that holds a notice type", () => {
      expect(
        failures(`${IMPORT}const type = "success";\ntoaster.create({ title: "x", type });`),
      ).toEqual([]);
    });
  });

  describe("when the file raises only notices or never imports the toaster", () => {
    /** @scenario "Notices and files without the toaster import are accepted" */
    it("reports nothing", () => {
      expect(
        failures(
          `${IMPORT}toaster.create({ title: "Saved", type: "success" });\n` +
            'toaster.create({ title: "Nothing matched", type: "warning" });\n' +
            'toaster.create({ title: "Requested", type: "info" });',
        ),
      ).toEqual([]);
      expect(
        failures(
          'import { useScenarioToaster } from "../behavior/scenario-feedback";\n' +
            'toaster.create({ title: "Couldn\'t save", type: "error" });',
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is a test or lives in apps/ui", () => {
    /** @scenario "Code outside feature-web modules is not governed" */
    it("reports nothing", () => {
      const code = `${IMPORT}toaster.error({ title: "x" });`;

      expect(failures(code, "modules/agent/browser/src/ui/__tests__/panel.unit.test.tsx")).toEqual(
        [],
      );
      expect(failures(code, "apps/ui/src/panel.tsx")).toEqual([]);
      expect(moduleToasters("createToaster({});", "apps/ui/src/toaster.ts")).toEqual([]);
    });
  });

  describe("when a finding is reported", () => {
    /** @scenario "A toaster finding says what to do instead" */
    it("names showErrorToast and the host port", () => {
      const [finding] = failures(`${IMPORT}toaster.error({ title: "x" });`);

      expect(finding.message).toContain("showErrorToast");
      expect(finding.message).toContain("host port");
    });
  });
});

describe("no-module-toaster", () => {
  describe("when a feature-web module carries a toaster of its own", () => {
    /** @scenario "A moved family does not carry a toaster of its own" */
    it("reports a renderer and a published toaster that shapes failures", () => {
      expect(
        moduleToasters(
          'import { createToaster } from "@chakra-ui/react";\nconst instance = createToaster({ placement: "bottom" });\nexport const toaster = { ...instance };',
        ).map((finding) => finding.messageId),
      ).toEqual(["ownRenderer"]);
      expect(
        moduleToasters(
          'export const toaster = {\n  error: (t) => shell.push({ ...t, type: "error" }),\n};',
        ).map((finding) => finding.messageId),
      ).toEqual(["ownFailureCopy"]);
    });
  });

  describe("when the local toaster only routes, raises no failure, or merely uses one", () => {
    /** @scenario "A local toaster that only routes to the host is accepted" */
    it("reports nothing", () => {
      expect(
        moduleToasters(
          'export const toaster = {\n  create(toast) {\n    if (toast.type === "error") { mounted.failed({ error: toast.error }); return; }\n    mounted.succeeded({ title: "x" });\n  },\n};',
        ),
      ).toEqual([]);
      expect(
        moduleToasters(
          'export const toaster = { info: (t) => shell.push({ ...t, type: "info" }) };',
        ),
      ).toEqual([]);
      expect(
        moduleToasters(`${IMPORT}toaster.create({ title: "Saved", type: "success" });`),
      ).toEqual([]);
    });
  });
});
