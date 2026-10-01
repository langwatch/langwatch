import { afterAll, describe, expect, it } from "vitest";

import { sharedSetupIsAHookRule } from "../../src/rules/shared-setup-is-a-hook.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const TEST_FILE = "modules/agent/process/src/__tests__/agent.unit.test.ts";

function report(code, filename = TEST_FILE) {
  return runRule(sharedSetupIsAHookRule, { code, cwd: workspace.cwd, filename });
}

describe("given a describe with sibling it blocks", () => {
  describe("when every sibling opens with the same three statements", () => {
    /** @scenario "sibling tests repeating three setup statements are reported" */
    it("reports siblingTestsRepeatSetup with the measured count and shared length", () => {
      const code = `
        describe("AgentService", () => {
          it("does one thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(1);
          });
          it("does another thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(2);
          });
          it("does a third thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(3);
          });
        });
      `;

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("siblingTestsRepeatSetup");
      expect(found[0].data).toEqual({ count: 3, shared: 3 });
      expect(found[0].message).toBe(
        "These 3 sibling tests each open with the same 3 statements. Move the repeated" +
          " statements into a `beforeEach(() => { ... })` at the top of this `describe` and" +
          " delete them from each test.",
      );
    });
  });

  describe("when the siblings only share two leading statements", () => {
    /** @scenario "two shared statements are left alone" */
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          it("does one thing", () => {
            const a = setup();
            const b = prepare(a);
            expect(a).toBe(1);
          });
          it("does another thing", () => {
            const a = setup();
            const b = prepare(a);
            expect(a).toBe(2);
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the identical run continues past an assertion", () => {
    /** @scenario "the shared prefix stops at the first assertion" */
    it("counts only the setup before the first expect", () => {
      const code = `
        describe("AgentService", () => {
          it("does one thing", async () => {
            const a = setup();
            await expect(load(a)).resolves.not.toBeNull();
            assert.ok(a);
            expect(a).toBe(1);
          });
          it("does another thing", async () => {
            const a = setup();
            await expect(load(a)).resolves.not.toBeNull();
            assert.ok(a);
            expect(a).toBe(2);
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the siblings open with distinct statements", () => {
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          it("does one thing", () => {
            const a = setupOne();
            expect(a).toBe(1);
          });
          it("does another thing", () => {
            const b = setupTwo();
            expect(b).toBe(2);
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when one sibling is an it.each and would otherwise share the prefix", () => {
    /** @scenario "a describe with a patterned test is left alone" */
    it("reports nothing, because the patterned sibling can't be verified against the prefix", () => {
      const code = `
        describe("AgentService", () => {
          it("does one thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(1);
          });
          it("does another thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(2);
          });
          it.each([[1], [2]])("does %s", (n) => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(n);
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when an existing beforeEach precedes siblings with no shared prefix", () => {
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          beforeEach(() => {
            setupShared();
          });
          it("does one thing", () => {
            const a = setup();
            expect(a).toBe(1);
          });
          it("does another thing", () => {
            const b = setup();
            expect(b).toBe(2);
          });
        });
      `;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when an existing beforeEach still leaves a three-statement shared prefix", () => {
    /** @scenario "shared setup above an existing beforeEach is still reported" */
    it("still reports siblingTestsRepeatSetup", () => {
      const code = `
        describe("AgentService", () => {
          beforeEach(() => {
            setupShared();
          });
          it("does one thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(1);
          });
          it("does another thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(2);
          });
        });
      `;

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("siblingTestsRepeatSetup");
      expect(found[0].data).toEqual({ count: 2, shared: 3 });
    });
  });

  describe("when the file is not a test file", () => {
    it("reports nothing", () => {
      const code = `
        describe("AgentService", () => {
          it("does one thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(1);
          });
          it("does another thing", () => {
            const a = setup();
            const b = prepare(a);
            const c = load(b);
            expect(c).toBe(2);
          });
        });
      `;

      expect(report(code, "modules/agent/process/src/agent.service.ts")).toEqual([]);
    });
  });
});
