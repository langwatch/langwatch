/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockProject = { id: "test-project" };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: mockProject,
    hasPermission: () => true,
  }),
}));

vi.mock("~/prompts/hooks/usePrompts", () => ({
  usePrompts: () => ({ deletePrompt: vi.fn() }),
}));

vi.mock("~/prompts/hooks/useRenamePromptHandle", () => ({
  useRenamePromptHandle: () => ({
    renameHandle: vi.fn(),
    canRename: true,
    permissionReason: undefined,
  }),
}));

vi.mock("../../../prompt-playground-store/DraggableTabsBrowserStore", () => ({
  useDraggableTabsBrowserStore: () => ({ addTab: vi.fn() }),
}));

vi.mock("~/components/annotations/DeleteConfirmationDialog", () => ({
  DeleteConfirmationDialog: () => null,
}));

vi.mock("~/prompts/components/CopyPromptDialog", () => ({
  CopyPromptDialog: () => null,
}));

vi.mock("~/prompts/components/PushToCopiesDialog", () => ({
  PushToCopiesDialog: () => null,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { mockGetResolvedDefault, mockCheckModifyPermission } = vi.hoisted(
  () => ({
    mockGetResolvedDefault: vi.fn(),
    mockCheckModifyPermission: vi.fn(),
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getResolvedDefault: {
        useQuery: mockGetResolvedDefault,
      },
    },
    prompts: {
      checkModifyPermission: {
        useQuery: mockCheckModifyPermission,
      },
      syncFromSource: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
    useContext: () => ({
      prompts: {
        getAllPromptsForProject: { invalidate: vi.fn() },
      },
    }),
  },
}));

// Import after mocks
import { PublishedPromptActions } from "../PublishedPromptActions";

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("PublishedPromptActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetResolvedDefault.mockReturnValue({ data: undefined });
    mockCheckModifyPermission.mockReturnValue({ data: undefined });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a rendered row menu", () => {
    describe("when the menu is closed", () => {
      it("does not enable the resolved-default model query", () => {
        renderWithChakra(
          <PublishedPromptActions
            promptId="prompt-1"
            promptHandle="test-prompt"
          />,
        );

        expect(mockGetResolvedDefault).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: "test-project" }),
          expect.objectContaining({ enabled: false }),
        );
      });

      it("does not enable the modify-permission query", () => {
        renderWithChakra(
          <PublishedPromptActions
            promptId="prompt-1"
            promptHandle="test-prompt"
          />,
        );

        expect(mockCheckModifyPermission).toHaveBeenCalledWith(
          expect.objectContaining({ idOrHandle: "prompt-1" }),
          expect.objectContaining({ enabled: false }),
        );
      });
    });

    describe("when the menu is opened", () => {
      it("enables the resolved-default model query", async () => {
        const user = userEvent.setup();
        renderWithChakra(
          <PublishedPromptActions
            promptId="prompt-1"
            promptHandle="test-prompt"
          />,
        );

        const trigger = screen.getByRole("button");
        await user.click(trigger);

        expect(mockGetResolvedDefault).toHaveBeenLastCalledWith(
          expect.objectContaining({ projectId: "test-project" }),
          expect.objectContaining({ enabled: true }),
        );
      });

      it("enables the modify-permission query", async () => {
        const user = userEvent.setup();
        renderWithChakra(
          <PublishedPromptActions
            promptId="prompt-1"
            promptHandle="test-prompt"
          />,
        );

        const trigger = screen.getByRole("button");
        await user.click(trigger);

        expect(mockCheckModifyPermission).toHaveBeenLastCalledWith(
          expect.objectContaining({ idOrHandle: "prompt-1" }),
          expect.objectContaining({ enabled: true }),
        );
      });
    });
  });
});
