/** Regression for Issue #3196 — SystemPromptRequiredError vs SystemPromptConflictError. */

import {
  PromptSystemPromptConflictError,
  PromptSystemPromptRequiredError,
} from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { createPromptServiceForTest } from "./prompt-service.test-fixture.ts";

describe("PromptService.createPrompt — missing system prompt (Issue #3196 regression)", () => {
  describe("given a PromptService", () => {
    describe("when creating a prompt with neither a prompt nor a system message", () => {
      /** @scenario "prompts.create returns 400 BAD_REQUEST when both prompt and system message are missing" */
      it("throws a HandledError with httpStatus 400 and code 'system_prompt_required' when no prompt and no system message are supplied", async () => {
        const service = createPromptServiceForTest();

        const error = await captureError(() =>
          service.createPrompt({
            projectId: "project-1",
            handle: "missing-system-prompt",
            messages: [{ role: "user", content: "{{input}}" }],
          }),
        );

        expect(error).toBeInstanceOf(PromptSystemPromptRequiredError);
        expect((error as PromptSystemPromptRequiredError).code).toBe(
          "prompt_system_prompt_required",
        );
        expect((error as Error).message).toMatch(/prompt or system message is required/i);
        expect((error as Error).message).not.toMatch(/SystemPromptConflictError/);
      });
    });

    describe("when creating a prompt with both a prompt and a system message", () => {
      /** @scenario "prompts.create still rejects when both prompt and a system message are provided (existing conflict preserved)" */
      it("still throws a HandledError with httpStatus 409 when both prompt and a system message are provided (no regression on AC 5)", async () => {
        const service = createPromptServiceForTest();

        const error = await captureError(() =>
          service.createPrompt({
            projectId: "project-1",
            handle: "conflicting-prompt",
            prompt: "You are a helpful assistant.",
            messages: [{ role: "system", content: "You are a helpful assistant." }],
          }),
        );

        expect(error).toBeInstanceOf(PromptSystemPromptConflictError);
        expect((error as PromptSystemPromptConflictError).code).toBe(
          "prompt_system_prompt_conflict",
        );
      });
    });
  });
});

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected fn to throw, but it resolved.");
}
