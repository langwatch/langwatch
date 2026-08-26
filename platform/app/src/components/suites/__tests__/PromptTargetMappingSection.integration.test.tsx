/**
 * @vitest-environment jsdom
 *
 * A prompt is authored in the prompt library and pointed at by a run plan, so
 * the binding between a simulation and the prompt's declared inputs is
 * configured on the run plan form (#6590). This section renders one mapping
 * block per selected prompt target that declares inputs, and nothing at all
 * when none do.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuiteTarget } from "~/server/suites/types";
import {
  type MappablePrompt,
  PromptTargetMappingSection,
} from "../PromptTargetMappingSection";

vi.mock("~/optimization_studio/components/code/workflow-code-editor.transport", () => ({
  CodeEditor: () => null,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const prompts: MappablePrompt[] = [
  {
    id: "prompt_with_inputs",
    handle: "support-agent",
    inputs: [
      { identifier: "question", type: "str" },
      { identifier: "customer_tier", type: "str" },
    ],
  },
  { id: "prompt_without_inputs", handle: "plain-prompt", inputs: [] },
];

function renderSection(selectedTargets: SuiteTarget[]) {
  return render(
    <PromptTargetMappingSection
      selectedTargets={selectedTargets}
      prompts={prompts}
      onMappingChange={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
}

afterEach(() => cleanup());

describe("PromptTargetMappingSection", () => {
  describe("given a selected prompt target that declares inputs", () => {
    it("renders a mapping block titled by the prompt's handle", () => {
      renderSection([{ type: "prompt", referenceId: "prompt_with_inputs" }]);

      expect(screen.getByText("support-agent")).toBeDefined();
      // The mapping section rows are the scenario fields a prompt input can read.
      expect(screen.getByText("input")).toBeDefined();
      expect(screen.getByText("threadId")).toBeDefined();
    });
  });

  describe("given only targets without declared inputs", () => {
    it("renders nothing for a prompt with no inputs", () => {
      const { container } = renderSection([
        { type: "prompt", referenceId: "prompt_without_inputs" },
      ]);

      expect(container.innerHTML).toBe("");
    });

    it("renders nothing for non-prompt targets", () => {
      const { container } = renderSection([{ type: "http", referenceId: "agent_http" }]);

      expect(container.innerHTML).toBe("");
    });
  });
});
