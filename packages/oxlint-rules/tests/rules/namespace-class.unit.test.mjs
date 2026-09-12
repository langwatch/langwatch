import { afterAll, describe, expect, it } from "vitest";
import { namespaceClassRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/server/src/services/agent-presence.service.ts";
const TEST = "modules/agent/server/src/services/__tests__/agent-presence.unit.test.ts";

function report(code, filename = SERVICE) {
  return runRule(namespaceClassRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature server module", () => {
  describe("when a class holds only static members", () => {
    /** @scenario "A class with only static members is reported as a module wearing a class" */
    it("reports namespaceClass naming the class and the member count", () => {
      const found = report(`export class AgentPresenceService {
  static isLive(input: { lastSeenAt: number; now: number }): boolean {
    return input.now - input.lastSeenAt < 30_000;
  }

  static ttlOf(input: { now: number }): number {
    return input.now + 30_000;
  }
}`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("namespaceClass");
      expect(found[0].message).toBe(
        "`AgentPresenceService` has only static members (2), so it is a module wearing a class." +
          " Export the functions from a `rules/` module and delete the class.",
      );
    });

    /** @scenario "A class with only static members is reported as a module wearing a class" */
    it("still reports it when a static create sits beside the statics", () => {
      const found = report(`export class AgentRuntimeService {
  static create(): AgentRuntimeService {
    return new AgentRuntimeService();
  }

  static tierOf(input: { sandboxed: boolean }): "host" | "sandbox" {
    return input.sandboxed ? "sandbox" : "host";
  }
}`);

      expect(found.map((entry) => entry.messageId)).toEqual(["namespaceClass"]);
    });
  });

  describe("when a class holds state or instance behaviour", () => {
    /** @scenario "A class with instance members is left alone" */
    it("reports nothing for a service with a create and instance methods", () => {
      const found = report(`export class AgentService {
  private constructor(private readonly repository: AgentRepository) {}

  static create(setup: { repository: AgentRepository }): AgentService {
    return new AgentService(setup.repository);
  }

  async getById(input: { id: string }): Promise<Agent> {
    return this.repository.getById(input);
  }
}`);

      expect(found).toEqual([]);
    });

    it("reports nothing for a class whose only static is create", () => {
      const found = report(`export class AgentClock {
  static create(): AgentClock {
    return new AgentClock();
  }
}`);

      expect(found).toEqual([]);
    });
  });

  describe("when the module is a test", () => {
    it("reports nothing", () => {
      const found = report(
        "export class Fixtures { static agent(): Agent { return { id: 'agent_1' }; } }",
        TEST,
      );

      expect(found).toEqual([]);
    });
  });
});
