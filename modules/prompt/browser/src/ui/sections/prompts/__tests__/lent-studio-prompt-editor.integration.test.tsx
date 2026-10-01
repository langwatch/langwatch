// @vitest-environment jsdom
import type { UiStudioPromptEditorProps } from "@langwatch/browser-host/declarations";
import type { Signature } from "@langwatch/workflow-contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { captured, fallbackFor } = vi.hoisted(() => ({
  captured: { props: {} as Record<string, unknown> },
  fallbackFor: vi.fn(),
}));

vi.mock("../prompt-editor-drawer.tsx", () => ({
  PromptEditorDrawer: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));
vi.mock("../../../../model/prompt-node-conversion.ts", () => ({
  nodeDataToLocalPromptConfig: fallbackFor,
}));

import { LentStudioPromptEditor } from "../lent-studio-prompt-editor.tsx";

afterEach(cleanup);

const nodeData: Signature = { name: "LLM Call", parameters: [] };

function props(): UiStudioPromptEditorProps {
  return {
    nodeData,
    onClose: vi.fn(),
    promptId: "prompt-1",
    promptVersionId: undefined,
    initialLocalConfig: undefined,
    onLocalConfigChange: vi.fn(),
    onSave: vi.fn(),
    onVersionChange: vi.fn(),
    availableSources: [],
    inputMappings: {},
    onInputMappingsChange: vi.fn(),
  };
}

describe("LentStudioPromptEditor", () => {
  describe("when the studio embeds it in a signature node's panel", () => {
    it("renders the editor headless, with the node's inline config as the not-found fallback", () => {
      const fallback = {
        llm: { model: "openai/gpt-5-mini" },
        messages: [],
        inputs: [],
        outputs: [],
      };
      fallbackFor.mockReturnValue(fallback);

      render(<LentStudioPromptEditor {...props()} />);

      expect(fallbackFor).toHaveBeenCalledWith(nodeData);
      expect(captured.props.headless).toBe(true);
      expect(captured.props.inlineConfigFallback).toBe(fallback);
      expect(captured.props.promptId).toBe("prompt-1");
    });
  });
});
