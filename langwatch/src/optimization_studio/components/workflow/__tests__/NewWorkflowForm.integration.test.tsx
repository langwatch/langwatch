/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import type { Workflow } from "../../../types/dsl";

// ---- Mocks ----

const mockMutate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    workflow: {
      create: {
        useMutation: () => ({
          mutate: mockMutate,
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("next/router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project", defaultModel: "gpt-5-mini" },
  }),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (fn: () => void) => fn(),
  }),
}));

vi.mock("~/utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Import after mocks
import { NewWorkflowForm } from "../NewWorkflowForm";
import { Dialog } from "~/components/ui/dialog";

// ---- Helpers ----

const buildTemplate = (overrides: Partial<Workflow> = {}): Workflow =>
  ({
    spec_version: "1.4",
    name: "My Imported Workflow",
    icon: "🧩",
    description: "A workflow",
    version: "22",
    default_llm: {
      model: "openai/gpt-4o",
      temperature: 0,
      max_tokens: 2048,
    },
    nodes: [],
    edges: [],
    template_adapter: "default",
    enable_tracing: false,
    state: {},
    ...overrides,
  } as Workflow);

const renderForm = (template: Workflow, onClose = vi.fn()) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Dialog.Root open>
        <Dialog.Content>
          <NewWorkflowForm template={template} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Root>
    </ChakraProvider>,
  );

// ---- Tests ----

describe("NewWorkflowForm", () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when creating a workflow from a template with a non-1 version", () => {
    it("resets version to '1' in the submitted DSL", async () => {
      const template = buildTemplate({ version: "22" });
      renderForm(template);

      // Submit via form directly — Dialog renders in a portal so we query document
      const form = document.querySelector("form")!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled();
      });

      const [mutationInput] = mockMutate.mock.calls[0] as [
        { dsl: Workflow; projectId: string; commitMessage: string },
      ];
      expect(mutationInput.dsl.version).toBe("1");
    });

    it("preserves other template fields in the submitted DSL", async () => {
      const template = buildTemplate({ version: "22", description: "Original desc" });
      renderForm(template);

      const form = document.querySelector("form")!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled();
      });

      const [mutationInput] = mockMutate.mock.calls[0] as [{ dsl: Workflow }];
      expect(mutationInput.dsl.description).toBe("Original desc");
    });
  });
});
