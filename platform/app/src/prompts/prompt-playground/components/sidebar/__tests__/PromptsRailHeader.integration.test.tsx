/**
 * @vitest-environment jsdom
 *
 * Covers specs/prompts/playground-surface-hierarchy.feature.
 *
 * The rail heads the list of prompts, so it is also where a prompt is added.
 * Only the draft creation, the permission check and the upgrade modal are
 * mocked; the header and the button itself render for real, so this fails if
 * the action goes back to the far side of the screen or loses its label.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useCreateDraftPrompt } from "../../../hooks/useCreateDraftPrompt";
import { PromptsRailHeader } from "../PromptsRailHeader";

vi.mock("../../../hooks/useCreateDraftPrompt", () => ({
  useCreateDraftPrompt: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

const openLiteMemberRestriction = vi.fn();
vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (
    selector: (state: {
      openLiteMemberRestriction: (params: { resource?: string }) => void;
    }) => unknown,
  ) => selector({ openLiteMemberRestriction }),
}));

const createDraftPrompt = vi.fn();

function givenPermission(hasPermission: boolean) {
  vi.mocked(useCreateDraftPrompt).mockReturnValue({
    createDraftPrompt,
  } as unknown as ReturnType<typeof useCreateDraftPrompt>);
  vi.mocked(useOrganizationTeamProject).mockReturnValue({
    hasPermission: () => hasPermission,
  } as unknown as ReturnType<typeof useOrganizationTeamProject>);
}

function renderHeader() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PromptsRailHeader />
    </ChakraProvider>,
  );
}

const addAction = () => screen.getByRole("button", { name: "New prompt" });

beforeEach(() => {
  givenPermission(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PromptsRailHeader", () => {
  describe("given the rail is on screen", () => {
    /** @scenario Adding a prompt is offered by the list of prompts */
    it("offers a new prompt beside the heading, in words", () => {
      renderHeader();

      expect(screen.getByText("Prompts")).toBeInTheDocument();
      expect(addAction()).toHaveTextContent("New prompt");
    });
  });

  describe("when someone allowed to create prompts uses it", () => {
    it("starts a new prompt", async () => {
      const user = userEvent.setup();
      renderHeader();

      await user.click(addAction());

      expect(createDraftPrompt).toHaveBeenCalledTimes(1);
    });
  });

  describe("when someone not allowed to create prompts uses it", () => {
    it("starts nothing, and says what is in the way", async () => {
      const user = userEvent.setup();
      givenPermission(false);
      renderHeader();

      await user.click(addAction());

      expect(createDraftPrompt).not.toHaveBeenCalled();
      expect(openLiteMemberRestriction).toHaveBeenCalledWith({
        resource: "prompts",
      });
    });
  });
});
