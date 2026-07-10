/**
 * @vitest-environment jsdom
 *
 * Covers the folder and crowded-strip rules in
 * specs/prompts/prompt-tab-switcher.feature.
 *
 * Only the tab's controller is mocked. The tab itself renders for real, so this
 * fails if the tab starts spending its narrow width on a folder name again, or
 * on a close button it has no room for.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabIdProvider } from "../../ui/TabContext";
import { PromptBrowserTab } from "../PromptBrowserTab";
import { usePromptBrowserTabController } from "../usePromptBrowserTabController";

vi.mock("../usePromptBrowserTabController", () => ({
  usePromptBrowserTabController: vi.fn(),
}));

const controllerOf = vi.mocked(usePromptBrowserTabController);

function givenTabTitled(title: string) {
  controllerOf.mockReturnValue({
    tab: { id: "tab-1", data: { meta: { title } } },
    hasUnsavedChanges: false,
    handleClose: vi.fn(),
    latestVersion: 1,
    isOutdated: false,
    handleUpgrade: vi.fn(),
    showVersionBadge: false,
  } as unknown as ReturnType<typeof usePromptBrowserTabController>);
}

function renderTab(props: { isActive?: boolean; isCrowded?: boolean } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TabIdProvider tabId="tab-1">
        <PromptBrowserTab {...props} />
      </TabIdProvider>
    </ChakraProvider>,
  );
}

const closeAction = () => screen.queryByRole("button", { name: /^Close / });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PromptBrowserTab", () => {
  describe("given the prompt lives in a folder", () => {
    /** @scenario A tab shows the prompt's name without its folder */
    it("shows the prompt's name, and keeps the full handle on hover", () => {
      givenTabTitled("onboarding/welcome");
      renderTab();

      const label = screen.getByText("welcome");

      expect(label).toBeInTheDocument();
      expect(screen.queryByText("onboarding/welcome")).not.toBeInTheDocument();
      expect(label).toHaveAttribute("title", "onboarding/welcome");
    });
  });

  describe("given the prompt lives at the top level", () => {
    it("shows the whole handle, there being no folder to strip", () => {
      givenTabTitled("classifier");
      renderTab();

      expect(screen.getByText("classifier")).toBeInTheDocument();
    });
  });

  describe("given the prompt has never been saved", () => {
    it("falls back to a placeholder title", () => {
      controllerOf.mockReturnValue({
        tab: { id: "tab-1", data: { meta: { title: null } } },
        hasUnsavedChanges: false,
        handleClose: vi.fn(),
        latestVersion: undefined,
        isOutdated: false,
        handleUpgrade: vi.fn(),
        showVersionBadge: false,
      } as unknown as ReturnType<typeof usePromptBrowserTabController>);
      renderTab();

      expect(screen.getByText("New Prompt")).toBeInTheDocument();
    });
  });

  describe("given the strip has run out of room", () => {
    describe("when the tab is not the active one", () => {
      /** @scenario An inactive tab drops its close button once the strip is crowded */
      it("drops the close button, while the active tab keeps one", () => {
        givenTabTitled("classifier");
        renderTab({ isActive: false, isCrowded: true });

        expect(closeAction()).not.toBeInTheDocument();
        expect(screen.getByText("classifier")).toBeInTheDocument();

        cleanup();
        givenTabTitled("summarizer");
        renderTab({ isActive: true, isCrowded: true });

        expect(closeAction()).toBeInTheDocument();
      });

      /** @scenario Pointing at a crowded tab brings its close button back */
      it("brings the close button back on hover", async () => {
        const user = userEvent.setup();
        givenTabTitled("classifier");
        renderTab({ isActive: false, isCrowded: true });

        await user.hover(screen.getByText("classifier"));

        expect(closeAction()).toBeInTheDocument();
      });

      it("takes the close button away again once the pointer leaves", async () => {
        const user = userEvent.setup();
        givenTabTitled("classifier");
        renderTab({ isActive: false, isCrowded: true });

        await user.hover(screen.getByText("classifier"));
        await user.unhover(screen.getByText("classifier"));

        expect(closeAction()).not.toBeInTheDocument();
      });
    });

    describe("when the tab is the active one", () => {
      it("keeps its close button", () => {
        givenTabTitled("summarizer");
        renderTab({ isActive: true, isCrowded: true });

        expect(closeAction()).toBeInTheDocument();
      });
    });
  });

  describe("given every tab still fits in the strip", () => {
    /** @scenario With room to spare every tab keeps its close button */
    it("keeps the close button on an inactive tab", () => {
      givenTabTitled("classifier");
      renderTab({ isActive: false, isCrowded: false });

      expect(closeAction()).toBeInTheDocument();
    });
  });
});
