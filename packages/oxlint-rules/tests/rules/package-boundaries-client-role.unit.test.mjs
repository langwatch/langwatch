import { afterAll, describe, expect, it } from "vitest";

import { boundaryRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { roles: { contract: {}, process: {}, browser: { exports: ["./declaration"] } } },
    project: {
      roles: { contract: {}, process: {}, browser: { exports: ["./declaration"] }, client: {} },
    },
  },
});

afterAll(() => workspace.cleanup());

/** The fixture declares no dependencies, so these read every finding but undeclaredDependency. */
function ids(filename, specifier) {
  return runRule(boundaryRule, {
    code: `import { x } from "${specifier}";`,
    cwd: workspace.cwd,
    filename,
  })
    .filter((entry) => entry.messageId !== "undeclaredDependency")
    .map((entry) => entry.messageId);
}

const CLIENT = "modules/project/client/src/project-picker.token.ts";

describe("given package-boundaries and a module client", () => {
  describe("when a client file imports React, browser-host, the wire or its own contract", () => {
    /** @scenario "A client file may import React, browser-host and the wire, and nothing else of a runtime" */
    it("reports nothing", () => {
      for (const specifier of [
        "react",
        "@langwatch/browser-host",
        "@langwatch/api/web",
        "@langwatch/project-contract",
      ]) {
        expect(ids(CLIENT, specifier)).toEqual([]);
      }
    });
  });

  describe("when a client file imports node, a component, the browser runtime, a process or a store", () => {
    /** @scenario "A client file may import React, browser-host and the wire, and nothing else of a runtime" */
    it("reports clientRuntime", () => {
      for (const specifier of [
        "node:fs",
        "react-dom",
        "@langwatch/design-system/primitives",
        "@langwatch/browser",
        "@langwatch/process",
        "@langwatch/prisma-client",
        "@langwatch/project-process",
        "@langwatch/agent-contract",
      ]) {
        expect(ids(CLIENT, specifier)).toEqual(["clientRuntime"]);
      }
    });
  });

  describe("when browser code imports a client", () => {
    /** @scenario "A client is read only by browser code" */
    it("reports nothing for another module's browser package or apps/ui", () => {
      for (const filename of [
        "modules/agent/browser/src/ui/sections/agent-header.tsx",
        "apps/ui/src/main.tsx",
      ]) {
        expect(ids(filename, "@langwatch/project-client")).toEqual([]);
      }
    });
  });

  describe("when a process, a contract or a server application imports a client", () => {
    /** @scenario "A client is read only by browser code" */
    it("reports clientConsumer", () => {
      for (const filename of [
        "modules/agent/process/src/services/agent.service.ts",
        "modules/project/process/src/services/project.service.ts",
        "modules/agent/contract/src/agent.api.ts",
        "apps/api/src/main.ts",
      ]) {
        expect(ids(filename, "@langwatch/project-client")).toEqual(["clientConsumer"]);
      }
    });
  });
});
