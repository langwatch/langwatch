import { afterAll, describe, expect, it } from "vitest";
import { noPortVocabularyRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noPortVocabularyRule, { code, cwd: workspace.cwd, filename });
}

describe("given a module source file", () => {
  describe("when it declares an interface whose name ends in Port", () => {
    it("reports portVocabulary", () => {
      const found = report(
        "export interface AgentNormalizePort { normalize(): void; }",
        "modules/agent/server/src/app/agent.app.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("portVocabulary");
      expect(found[0].data.name).toBe("AgentNormalizePort");
    });
  });

  describe("when it declares a class whose name ends in Port", () => {
    it("reports portVocabulary", () => {
      const found = report(
        "export class AgentSpendPort {}",
        "modules/agent/server/src/services/agent-spend.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].data.name).toBe("AgentSpendPort");
    });
  });

  describe("when it imports a name ending in Port", () => {
    it("reports portVocabulary", () => {
      const found = report(
        "import type { UiRpcPort } from './ui-rpc.ts';",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found.some((finding) => finding.data.name === "UiRpcPort")).toBe(true);
    });
  });

  describe("when it re-exports from a ports folder", () => {
    it("reports portVocabulary", () => {
      const found = report(
        "export { AgentClock } from './ports/agent-clock.port.ts';",
        "modules/agent/server/src/index.ts",
      );

      expect(found.some((finding) => finding.messageId === "portVocabulary")).toBe(true);
    });
  });

  describe("when the file itself lives under a ports folder", () => {
    it("reports portFile", () => {
      const found = report(
        "export const nothing = 1;",
        "modules/agent/server/src/ports/agent.port.ts",
      );

      expect(found.some((finding) => finding.messageId === "portFile")).toBe(true);
    });
  });
});

describe("given source that names a network port or a word containing port", () => {
  describe("when it declares a lower camel case network port", () => {
    it("reports nothing", () => {
      const found = report(
        "const freePort = 5560; export const chosenPort = freePort;",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(0);
    });
  });

  describe("when it names transport, report, support, import or export", () => {
    it("reports nothing", () => {
      const found = report(
        "import { RestTransportRoute } from '@langwatch/api';\nexport function reportSupport() { return RestTransportRoute; }",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(0);
    });
  });
});
