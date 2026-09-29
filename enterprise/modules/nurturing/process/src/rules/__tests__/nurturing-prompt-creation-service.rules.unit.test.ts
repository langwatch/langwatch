/**
 * What writing a prompt tells Customer.io, and once only for the first one.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import { firePromptCreated } from "../nurturing-prompt-creation-service.rules.ts";

describe("firePromptCreated", () => {
  describe("given an organization with no prompts across any project", () => {
    describe("when the first prompt is created", () => {
      const calls = firePromptCreated({
        userId: "user-1",
        projectId: "project-1",
        orgPromptCount: 1,
      });

      /** @scenario "First prompt creation identifies user with has_prompts true" */
      it("decides to identify them with has_prompts and an org-wide count of one", () => {
        expect(calls[0]).toEqual({
          type: "identify",
          userId: "user-1",
          traits: { has_prompts: true, prompt_count: 1 },
        });
      });

      /** @scenario "First prompt creation fires first_prompt_created event" */
      it("decides to track first_prompt_created against the project", () => {
        expect(calls[1]).toEqual({
          type: "track",
          userId: "user-1",
          event: "first_prompt_created",
          properties: { project_id: "project-1" },
        });
      });
    });
  });

  describe("given an organization that already has prompts", () => {
    describe("when another prompt is created in any project", () => {
      /** @scenario "Subsequent prompt creation updates org-wide prompt_count without firing first event" */
      it("decides to update the org-wide count and track nothing", () => {
        const calls = firePromptCreated({
          userId: "user-1",
          projectId: "project-2",
          orgPromptCount: 4,
        });

        expect(calls).toEqual([
          { type: "identify", userId: "user-1", traits: { has_prompts: true, prompt_count: 4 } },
        ]);
      });
    });
  });
});
