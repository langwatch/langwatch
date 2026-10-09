/**
 * Which scopes may judge.
 *
 * A judgement is charged to a project, and a LangWatch key can read several.
 * The gate therefore takes the whole scope rather than one project id: a key
 * spanning more than one has no single owner for the bill, so it is refused
 * before the flag is even asked. A single-project scope falls through to that
 * project's own flag, which is the condition the rest of the feature is built
 * on.
 *
 * The per-project flag is stated rather than read, so these answers do not move
 * with whatever the ambient environment has configured — the same reason
 * `instantEvalsEnabled` takes `isClassifierConfigured`.
 *
 * @see ../instantEvalSupport.ts
 * @see specs/lwql/eval-functions.feature
 */

import { describe, expect, it } from "vitest";

import { createLangWatchQLInstantEvalSupport } from "../instantEvalSupport";

/** The projects whose flag is on. Anything else answers false. */
const ENABLED = new Set(["project-a", "project-b"]);

/** Records which projects the gate actually asked about, so order is observable. */
function supportWithStatedFlag() {
  const asked: string[] = [];
  const support = createLangWatchQLInstantEvalSupport({
    recorder: { recordSpend: async () => {} },
    isProjectEnabled: async (projectId) => {
      asked.push(projectId);
      return ENABLED.has(projectId);
    },
  });
  return { support, asked };
}

describe("given a key that reads more than one project", () => {
  describe("when the caller asks whether Instant Evals are open to it", () => {
    /** @scenario "An eval function is refused for a key that reads more than one project" */
    it("answers no even though both projects have the flag on", async () => {
      const { support, asked } = supportWithStatedFlag();

      await expect(
        support.isEnabled({ projectIds: ["project-a", "project-b"] }),
      ).resolves.toBe(false);
      // Refused on the scope alone: asking either project would be asking a
      // question whose answer cannot decide who is billed.
      expect(asked).toEqual([]);
    });
  });
});

describe("given a key that reads one project", () => {
  describe("when the caller asks whether Instant Evals are open to it", () => {
    /** @scenario "A key that reads one project is judged on that project's own flag" */
    it("answers with that project's own flag", async () => {
      const { support, asked } = supportWithStatedFlag();

      await expect(
        support.isEnabled({ projectIds: ["project-a"] }),
      ).resolves.toBe(true);
      await expect(
        support.isEnabled({ projectIds: ["project-c"] }),
      ).resolves.toBe(false);
      expect(asked).toEqual(["project-a", "project-c"]);
    });
  });
});

describe("given a key that reads no project at all", () => {
  describe("when the caller asks whether Instant Evals are open to it", () => {
    it("answers no rather than treating an empty scope as unrestricted", async () => {
      const { support, asked } = supportWithStatedFlag();

      await expect(support.isEnabled({ projectIds: [] })).resolves.toBe(false);
      expect(asked).toEqual([]);
    });
  });
});
