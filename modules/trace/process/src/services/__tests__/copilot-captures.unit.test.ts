import { describe, expect, it } from "vitest";

import { canonicalisation } from "./canonicalisation/test-helpers.ts";
import cliChatSpan from "./fixtures/copilot-cli-b.chat.json";
import cliToolSpan from "./fixtures/copilot-cli-b.execute-tool.json";
import cliAgentWithGitSpan from "./fixtures/copilot-cli-b.invoke-agent.git-context.json";
import cliAgentSpan from "./fixtures/copilot-cli-b.invoke-agent.json";
import vscodeToolSpan from "./fixtures/copilot-vscode-b.execute-tool.json";
import vscodeAgentSpan from "./fixtures/copilot-vscode-b.invoke-agent.json";

/** A redacted span from a real Copilot build; `vendorVersion` names the build (#8803). */
interface CapturedSpan {
  scopeName: string;
  spanName: string;
  vendorVersion: string;
  attributes: Record<string, unknown>;
}

const canonicalizeCaptured = (captured: CapturedSpan) =>
  canonicalisation.canonicalizeSpanAttributes({
    spanAttributes: captured.attributes,
    events: [],
    span: {
      name: captured.spanName,
      kind: 0,
      instrumentationScope: { name: captured.scopeName, version: captured.vendorVersion },
      statusMessage: null,
      statusCode: null,
      parentSpanId: null,
    },
  }).attributes;

describe("Copilot canonicalisation over real captures", () => {
  describe("given a chat span captured from Copilot CLI 1.0.100", () => {
    describe("when the canonicalisation chain runs", () => {
      const attributes = canonicalizeCaptured(cliChatSpan);

      /** @scenario A captured Copilot CLI chat span carries model, tokens and the session key */
      it("carries the model, the token counts and the conversation id", () => {
        expect(attributes["gen_ai.request.model"]).toBe(
          cliChatSpan.attributes["gen_ai.request.model"],
        );
        expect(attributes["gen_ai.usage.output_tokens"]).toBe(38);
        expect(attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(17039);
        expect(attributes["gen_ai.conversation.id"]).toBe(
          cliChatSpan.attributes["gen_ai.conversation.id"],
        );
      });

      /** @scenario A captured Copilot CLI chat span carries model, tokens and the session key */
      it("records the AI-unit count as metadata, never as a dollar cost", () => {
        expect(attributes["metadata.copilot_nano_aiu"]).toBe("214917500");
        expect(attributes["langwatch.span.cost"]).toBeUndefined();
      });
    });
  });

  describe("given an invoke_agent span captured from Copilot CLI 1.0.100", () => {
    describe("when the canonicalisation chain runs", () => {
      const attributes = canonicalizeCaptured(cliAgentSpan);

      /** @scenario A captured Copilot CLI agent rollup is not counted on top of its chat spans */
      it("flags the rollup to skip token accumulation", () => {
        expect(attributes["langwatch.reserved.skip_token_accumulation"]).toBe("true");
      });

      /** @scenario Repository context is lifted only from Copilot builds that send it */
      it("carries no repository, since this build sends no git attributes", () => {
        expect(attributes["metadata.copilot_repository"]).toBeUndefined();
      });
    });
  });

  describe("given an invoke_agent span captured from Copilot CLI 1.0.79", () => {
    describe("when the canonicalisation chain runs", () => {
      const attributes = canonicalizeCaptured(cliAgentWithGitSpan);

      /** @scenario Repository context is lifted only from Copilot builds that send it */
      it("carries the repository and organization as metadata", () => {
        expect(attributes["metadata.copilot_repository"]).toBe("example-org/repo-a");
        expect(attributes["metadata.copilot_organization"]).toBe("example-org");
      });
    });
  });

  describe("given an invoke_agent span captured from VS Code Copilot Chat 0.67", () => {
    describe("when the canonicalisation chain runs", () => {
      const attributes = canonicalizeCaptured(vscodeAgentSpan);

      /** @scenario A captured VS Code agent rollup keeps the repository as the remote URL it was sent as */
      it("carries the repository remote URL as metadata", () => {
        expect(attributes["metadata.copilot_repository"]).toBe(
          "https://github.com/example-org/repo-b.git",
        );
      });
    });
  });

  describe.each([
    { surface: "Copilot CLI 1.0.100", captured: cliToolSpan },
    { surface: "VS Code Copilot Chat 0.67", captured: vscodeToolSpan },
  ])("given an execute_tool span captured from $surface", ({ captured }) => {
    describe("when the canonicalisation chain runs", () => {
      const attributes = canonicalizeCaptured(captured);

      /** @scenario A captured Copilot tool run is a tool span that keeps its name and session key */
      it("types the span as a tool", () => {
        expect(attributes["langwatch.span.type"]).toBe("tool");
      });

      /** @scenario A captured Copilot tool run is a tool span that keeps its name and session key */
      it("keeps the tool name and the conversation id", () => {
        expect(attributes["gen_ai.tool.name"]).toBe(captured.attributes["gen_ai.tool.name"]);
        expect(attributes["gen_ai.conversation.id"]).toBe(
          captured.attributes["gen_ai.conversation.id"],
        );
      });
    });
  });
});
