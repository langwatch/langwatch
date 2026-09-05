/**
 * The workflow scaffold round-trip (Issue #3196): a signature node carrying the
 * registry's default system message must keep that message when it crosses the
 * bridge into the prompt editor's LocalPromptConfig. Losing it puts the user's
 * first Save back on the empty-system codepath.
 *
 * The shape below mirrors the scaffold the studio registry produces; the
 * registry itself is not imported, to keep this a unit test.
 */
import { describe, expect, it } from "vitest";
import { nodeDataToLocalPromptConfig } from "../llm-prompt-config-utils";

describe("nodeDataToLocalPromptConfig — workflow scaffold round-trip (Issue #3196)", () => {
  describe("given a scaffolded signature node carrying the registry's default system message", () => {
    describe("when converting the node data to LocalPromptConfig", () => {
      /** @scenario "New workflow's default prompt node is scaffolded with the default system prompt" */
      it("preserves the default system message in the messages array", () => {
        const scaffoldedNodeData = {
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
          parameters: [
            {
              identifier: "llm",
              type: "llm" as const,
              value: {
                model: "openai/gpt-5-mini",
                temperature: 0,
                max_tokens: 2048,
              },
            },
            {
              identifier: "prompting_technique",
              type: "prompting_technique" as const,
              value: void 0,
            },
            {
              identifier: "instructions",
              type: "str" as const,
              value: "You are a helpful assistant.",
            },
            {
              identifier: "messages",
              type: "chat_messages" as const,
              value: [{ role: "user" as const, content: "{{input}}" }],
            },
            {
              identifier: "demonstrations",
              type: "dataset" as const,
              value: void 0,
            },
          ],
        };

        const result = nodeDataToLocalPromptConfig(scaffoldedNodeData as never);

        expect(result).not.toBeUndefined();
        expect(result!.messages).toEqual([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "{{input}}" },
        ]);
      });
    });
  });
});
