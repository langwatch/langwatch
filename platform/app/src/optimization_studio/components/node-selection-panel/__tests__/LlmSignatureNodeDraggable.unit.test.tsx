/**
 * @vitest-environment jsdom
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * Nodes own their LLM config: a signature node dragged from the panel
 * must be born with a concrete model — the project's cascade-resolved
 * default when one is set, the registry flagship otherwise. There is no
 * workflow-level default left to inherit from later.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getResolvedDefaultUseQuery = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getResolvedDefault: {
        useQuery: (...args: unknown[]) => getResolvedDefaultUseQuery(...args),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

const nodeDraggableProps = vi.fn();
vi.mock("../NodeDraggable", () => ({
  NodeDraggable: (props: unknown) => {
    nodeDraggableProps(props);
    return null;
  },
}));

import { DEFAULT_MODEL } from "~/utils/constants";
import { LlmSignatureNodeDraggable } from "../LlmSignatureNodeDraggable";

const draggedLlmValue = () => {
  const props = nodeDraggableProps.mock.calls.at(-1)![0] as {
    component: { parameters: Array<{ identifier: string; value: unknown }> };
  };
  return props.component.parameters.find((p) => p.identifier === "llm")
    ?.value as { model: string };
};

describe("LlmSignatureNodeDraggable", () => {
  beforeEach(() => {
    nodeDraggableProps.mockClear();
    getResolvedDefaultUseQuery.mockReset();
  });

  /** @scenario Dragging a new signature node seeds it with the resolved default */
  it("seeds the dragged node with the cascade-resolved model", () => {
    getResolvedDefaultUseQuery.mockReturnValue({
      data: { model: "anthropic/claude-haiku-4-5-20251001" },
    });

    render(<LlmSignatureNodeDraggable />);

    expect(getResolvedDefaultUseQuery).toHaveBeenCalledWith(
      { projectId: "project-1", featureKey: "workflows.create_default" },
      { enabled: true },
    );
    // The signature module contributes its own sampling defaults; the
    // load-bearing claim is the model.
    expect(draggedLlmValue().model).toBe("anthropic/claude-haiku-4-5-20251001");
  });

  it("falls back to the registry flagship when nothing is configured", () => {
    getResolvedDefaultUseQuery.mockReturnValue({ data: null });

    render(<LlmSignatureNodeDraggable />);

    expect(draggedLlmValue().model).toBe(DEFAULT_MODEL);
  });
});
