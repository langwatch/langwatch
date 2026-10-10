import { afterAll, describe, expect, it } from "vitest";

import { noAmbientContextRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noAmbientContextRule, { code, cwd: workspace.cwd, filename });
}

const NAMED_IMPORT = [
  'import { AsyncLocalStorage } from "node:async_hooks";',
  "export const scope = new AsyncLocalStorage();",
].join("\n");

describe("given module source", () => {
  describe("when it creates an AsyncLocalStorage", () => {
    /** @scenario "A module's source does not carry a scope through AsyncLocalStorage" */
    it.each([
      "modules/agent/process/src/services/agent.service.ts",
      "enterprise/modules/billing/process/src/services/billing.service.ts",
      "modules/auth/process/src/channels/memory/memory.session.channel.ts",
    ])("reports ambientContext for %s", (file) => {
      const found = report(NAMED_IMPORT, file);

      expect(found.map((finding) => finding.messageId)).toEqual(["ambientContext"]);
      expect(found[0].line).toBe(1);
      expect(found[0].message).toContain("named parameter");
    });

    /** @scenario "A module's source does not carry a scope through AsyncLocalStorage" */
    it("reports a namespace use and the bare node:async_hooks specifier", () => {
      const found = report(
        'import * as hooks from "async_hooks";\nexport const scope = new hooks.AsyncLocalStorage();',
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found.map((finding) => finding.messageId)).toEqual(["ambientContext"]);
      expect(found[0].line).toBe(2);
    });
  });

  describe("when it imports something else from node:async_hooks", () => {
    it("reports nothing", () => {
      expect(
        report(
          'import { AsyncResource } from "node:async_hooks";\nexport const x = AsyncResource;',
          "modules/agent/process/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given Better Auth's http channels in the auth module", () => {
  /** @scenario "Auth's Better Auth http channels may use AsyncLocalStorage" */
  it.each([
    "modules/auth/process/src/channels/http/http.session-callback-evidence.channel.ts",
    "modules/auth/process/src/channels/http/http.id-token-issuer-refusal.channel.ts",
  ])("reports nothing for %s", (file) => {
    expect(report(NAMED_IMPORT, file)).toEqual([]);
  });
});

describe("given a file outside module source or a test", () => {
  /** @scenario "Framework packages and tests are not governed" */
  it.each([
    "packages/observability/src/context/core.ts",
    "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts",
  ])("reports nothing for %s", (file) => {
    expect(report(NAMED_IMPORT, file)).toEqual([]);
  });
});
