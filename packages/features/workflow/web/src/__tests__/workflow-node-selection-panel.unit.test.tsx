/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Component } from "@langwatch/workflow-contract";

const captured = vi.hoisted<{ component: Component | null }>(() => ({ component: null }));

vi.mock("../ui/sections/workflow-node-draggable", () => ({
  NodeDraggable: ({ component }: { component: Component }) => {
    captured.component = component;
    return null;
  },
}));

import { LlmSignatureNodeDraggable } from "../ui/sections/workflow-node-selection-panel";

describe("LlmSignatureNodeDraggable", () => {
  beforeEach(() => {
    captured.component = null;
  });

  it("seeds a dragged signature node with the app-resolved model", () => {
    render(<LlmSignatureNodeDraggable model="anthropic/claude-haiku-4-5-20251001" />);

    const llmParameter = captured.component?.parameters?.find(
      (parameter) => parameter.identifier === "llm",
    );

    expect(llmParameter?.value).toMatchObject({
      model: "anthropic/claude-haiku-4-5-20251001",
    });
  });
});
