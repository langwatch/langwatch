/**
 * The `secret_snippet` tool bridge (specs/langy/langy-secret-snippet.feature):
 * which calls become cards, what the card renders, and what stands in for a
 * secret that is gone.
 */
import { describe, expect, it } from "vitest";

import {
  isSecretSnippetToolPart,
  maskedSecretValue,
  renderSecretSnippet,
  secretSnippetCalls,
} from "../langySecretSnippetTool";

const TEMPLATE =
  'export OPENAI_BASE_URL="https://gateway.acme.example/v1"\nexport OPENAI_API_KEY="{{secret}}"';

function call(
  id: string,
  input: Record<string, unknown>,
  state = "output-available",
) {
  return { type: "tool-secret_snippet", state, toolCallId: id, input };
}

describe("secretSnippetCalls", () => {
  describe("given a message with a complete secret_snippet call", () => {
    it("yields one card with the reveal id, the template and the preview", () => {
      expect(
        secretSnippetCalls([
          { type: "text", text: "Your key production-app is live." },
          call("c1", {
            revealId: "rvl_abc",
            template: TEMPLATE,
            preview: "vk-lw-01HZX9N",
          }),
        ]),
      ).toEqual([
        {
          callId: "c1",
          revealId: "rvl_abc",
          template: TEMPLATE,
          preview: "vk-lw-01HZX9N",
        },
      ]);
    });

    it("reads the dynamic-tool shape too, and a missing preview as null", () => {
      expect(
        secretSnippetCalls([
          {
            type: "dynamic-tool",
            toolName: "secret_snippet",
            state: "input-available",
            toolCallId: "c2",
            input: { revealId: " rvl_abc ", template: TEMPLATE },
          },
        ]),
      ).toEqual([
        {
          callId: "c2",
          revealId: "rvl_abc",
          template: TEMPLATE,
          preview: null,
        },
      ]);
    });
  });

  describe("given a call the worker refused", () => {
    it("draws no card for a template without the placeholder, or for a missing reveal id", () => {
      expect(
        secretSnippetCalls([
          call("c1", { revealId: "rvl_abc", template: 'export KEY="<key>"' }),
          call("c2", { template: TEMPLATE }),
          call("c3", { revealId: "", template: TEMPLATE }),
        ]),
      ).toEqual([]);
    });
  });

  describe("given a call still streaming its input", () => {
    it("draws nothing until the input is complete", () => {
      expect(
        secretSnippetCalls([
          call(
            "c1",
            { revealId: "rvl_abc", template: TEMPLATE },
            "input-streaming",
          ),
        ]),
      ).toEqual([]);
    });
  });

  describe("given other tool parts", () => {
    it("recognises only the secret_snippet tool", () => {
      expect(isSecretSnippetToolPart(call("c1", {}))).toBe(true);
      expect(
        isSecretSnippetToolPart({ type: "tool-question", toolCallId: "q" }),
      ).toBe(false);
      expect(isSecretSnippetToolPart({ type: "text", text: "hi" })).toBe(false);
    });
  });
});

describe("renderSecretSnippet", () => {
  it("puts the value where every placeholder stood", () => {
    expect(
      renderSecretSnippet({
        template: "a={{secret}}\nb={{secret}}",
        value: "vk-lw-X",
      }),
    ).toBe("a=vk-lw-X\nb=vk-lw-X");
  });
});

describe("maskedSecretValue", () => {
  it("shows the display prefix and three dots, or the key family's prefix when none was given", () => {
    expect(maskedSecretValue("vk-lw-01HZX9N")).toBe("vk-lw-01HZX9N...");
    expect(maskedSecretValue(null)).toBe("vk-lw-...");
  });
});
