/**
 * Unit tests for the prompt form schema's system-prompt-required refinement.
 *
 * The refinement is the client-side counterpart to the server's
 * `SystemPromptRequiredError` (#3196): without it, the form lets a user
 * click **Save** on a freshly-scaffolded workflow whose system message is
 * empty, then surprises them with a server error.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_FORM_VALUES } from "~/prompts/utils/buildDefaultFormValues";
import { formSchemaForSave } from "../form-schema";

describe("formSchemaForSave — system prompt required refinement (Issue #3196)", () => {
  function valuesWithMessages(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ) {
    return {
      ...DEFAULT_FORM_VALUES,
      version: {
        ...DEFAULT_FORM_VALUES.version,
        configData: {
          ...DEFAULT_FORM_VALUES.version.configData,
          messages,
        },
      },
    };
  }

  describe("when the messages array has no system message", () => {
    /** @scenario "Prompt form schema rejects messages with no system content" */
    it("reports a system-prompt-required error on the messages path", () => {
      const result = formSchemaForSave.safeParse(
        valuesWithMessages([{ role: "user", content: "{{input}}" }]),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      const messagesPath = result.error.issues.find(
        (issue) =>
          issue.path[0] === "version" &&
          issue.path[1] === "configData" &&
          issue.path[2] === "messages",
      );
      expect(messagesPath).toBeDefined();
      expect(messagesPath?.message).toMatch(/system prompt is required/i);
    });
  });

  describe("when the system message exists but is empty / whitespace only", () => {
    /** @scenario "Prompt form schema rejects messages with no system content" */
    it("rejects an empty-string system message", () => {
      const result = formSchemaForSave.safeParse(
        valuesWithMessages([
          { role: "system", content: "" },
          { role: "user", content: "{{input}}" },
        ]),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      const messagesPath = result.error.issues.find(
        (issue) => issue.path[2] === "messages",
      );
      expect(messagesPath?.message).toMatch(/system prompt is required/i);
    });

    /** @scenario "Prompt form schema rejects messages with no system content" */
    it("rejects a whitespace-only system message", () => {
      const result = formSchemaForSave.safeParse(
        valuesWithMessages([
          { role: "system", content: "   \n\t  " },
          { role: "user", content: "{{input}}" },
        ]),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      const messagesPath = result.error.issues.find(
        (issue) => issue.path[2] === "messages",
      );
      expect(messagesPath?.message).toMatch(/system prompt is required/i);
    });
  });

  describe("when the system message has non-empty content", () => {
    it("passes validation (happy path / no regression on AC 4)", () => {
      const result = formSchemaForSave.safeParse(
        valuesWithMessages([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "{{input}}" },
        ]),
      );

      expect(result.success).toBe(true);
    });
  });
});
