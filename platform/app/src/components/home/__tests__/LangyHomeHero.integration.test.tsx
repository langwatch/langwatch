/**
 * @vitest-environment jsdom
 *
 * The hero's onboarding control, restored: a new project leads with a
 * prominent "Send your first trace" above the ask chips, a populated project
 * keeps the quiet "Onboard your agent" beneath them, and neither renders
 * while the project's reach is still unknown. And the field's one rule
 * about conversations: while the panel is open on one, the field stands
 * down to a line that continues it.
 *
 * Spec: specs/home/langy-home.feature
 *
 * Boundary mocks: the command palette (renders its own field), Langy access
 * and store, the ambient dev state, and the project's reach.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/command-bar/CommandPalette", () => ({
  CommandPalette: () => <input placeholder="ask" />,
}));
vi.mock("~/features/command-bar/CommandBarContext", () => ({
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));
const canAskMock = vi.fn(() => true);
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => canAskMock(),
}));
// The store as the hero reads it: what the field does with a question, and
// whether a conversation is open. A plain object, set per test.
const langyState = {
  askLangy: vi.fn(),
  openPanel: vi.fn(),
  isOpen: false,
  activeConversationId: null as string | null,
  pendingPrompt: null as string | null,
};
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (s: typeof langyState) => unknown) =>
    selector(langyState),
}));
vi.mock("../dev/homeDevState", () => ({
  useHomeDevState: () => null,
}));
vi.mock("../WelcomeHeader", () => ({
  WelcomeHeader: () => <div>Good morning</div>,
}));

const reachMock = vi.fn();
vi.mock("../useProjectReach", () => ({
  useProjectReach: () => reachMock(),
}));

// The pill's menu is `AgentActionsMenu`, which reads the project for its
// key and fetches the skill the copy hands over.
// The guided onboarding offer reads its flag and state over tRPC; this
// suite covers the hero, not the offer.
vi.mock("~/features/guided-onboarding/home/GuidedOnboardingOffer", () => ({
  GuidedOnboardingOffer: () => null,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", apiKey: "sk-lw-home" },
    organization: { id: "org_1" },
  }),
}));
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { BASE_HOST: "https://app.langwatch.ai" } }),
}));
const SKILL_BODY = "# Add LangWatch Tracing to Your Code";
vi.mock("~/utils/api", () => ({
  api: {
    setupSkills: {
      getPrompt: { useQuery: () => ({ data: { body: SKILL_BODY } }) },
    },
  },
}));

import { LangyHomeHero } from "../LangyHomeHero";

function renderHero() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyHomeHero />
    </ChakraProvider>,
  );
}

const onboardingTriggers = () =>
  screen
    .queryAllByRole("button")
    .filter((b) => b.getAttribute("aria-haspopup") === "menu");

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
  langyState.isOpen = false;
  langyState.activeConversationId = null;
  langyState.pendingPrompt = null;
});

const NEW_PROJECT_REACH = {
  isLoading: false,
  isNewProject: true,
  hasTraces: false,
  hasEvaluations: false,
  hasExperiments: false,
};

const POPULATED_REACH = {
  isLoading: false,
  isNewProject: false,
  hasTraces: true,
  hasEvaluations: true,
  hasExperiments: true,
};

/** True when `a` comes before `b` in the document. */
const renders_before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("LangyHomeHero onboarding control", () => {
  describe("when the project has no traces yet", () => {
    /** @scenario A new project leads with sending the first trace */
    it("leads with a prominent Send your first trace control above the chips", () => {
      reachMock.mockReturnValue(NEW_PROJECT_REACH);
      renderHero();

      const pill = screen.getByText("Send your first trace");
      expect(onboardingTriggers()).toHaveLength(1);
      // ABOVE the ask chips: the pill precedes the empty-project asks.
      const chip = screen.getByText("Show me around");
      expect(renders_before(pill, chip)).toBe(true);
    });

    describe("when the pill's menu is opened with ask access", () => {
      it("offers the coding-agent prompt first, then the walkthrough, then the docs", async () => {
        reachMock.mockReturnValue(NEW_PROJECT_REACH);
        renderHero();

        await userEvent.click(onboardingTriggers()[0]!);

        const copy = await screen.findByText(
          "Copy a prompt for your coding agent",
        );
        const walkthrough = screen.getByText("Walk me through it");
        const docs = screen.getByText("Read the integration guide");

        // The same order every empty page's setup menu offers.
        expect(renders_before(copy, walkthrough)).toBe(true);
        expect(renders_before(walkthrough, docs)).toBe(true);
      });

      it("copies the tracing skill led by the project's keys", async () => {
        reachMock.mockReturnValue(NEW_PROJECT_REACH);
        let copied = "";
        const writeText = vi.fn((text: string) => {
          copied = text;
          return Promise.resolve();
        });
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText },
          configurable: true,
        });
        renderHero();

        await userEvent.click(onboardingTriggers()[0]!);
        await userEvent.click(
          await screen.findByText("Copy a prompt for your coding agent"),
        );

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(copied.indexOf("Use these keys to instrument:")).toBe(0);
        expect(copied).toContain('LANGWATCH_API_KEY="sk-lw-home"');
        expect(copied.indexOf(SKILL_BODY)).toBeGreaterThan(0);
        // Cloud is the SDK default, so no endpoint line to get wrong.
        expect(copied).not.toContain("LANGWATCH_ENDPOINT");
      });
    });

    describe("when the reader cannot start conversations", () => {
      it("withholds the walkthrough route but keeps the others", async () => {
        canAskMock.mockReturnValue(false);
        reachMock.mockReturnValue(NEW_PROJECT_REACH);
        renderHero();

        await userEvent.click(onboardingTriggers()[0]!);

        expect(
          await screen.findByText("Copy a prompt for your coding agent"),
        ).toBeDefined();
        expect(screen.queryByText("Walk me through it")).toBeNull();
        expect(screen.getByText("Read the integration guide")).toBeDefined();
      });

      it("drops the Langy glyph so the tiles still count the routes", () => {
        canAskMock.mockReturnValue(false);
        reachMock.mockReturnValue(NEW_PROJECT_REACH);
        renderHero();

        const withoutLangy =
          onboardingTriggers()[0]!.querySelectorAll("svg").length;
        cleanup();

        canAskMock.mockReturnValue(true);
        renderHero();
        const withLangy =
          onboardingTriggers()[0]!.querySelectorAll("svg").length;

        expect(withoutLangy).toBe(withLangy - 1);
      });
    });
  });

  describe("when the project is populated", () => {
    /** @scenario A populated project keeps the quiet onboarding route */
    it("keeps the quiet Onboard your agent route beneath the chips", () => {
      reachMock.mockReturnValue(POPULATED_REACH);
      renderHero();

      expect(screen.queryByText("Send your first trace")).toBeNull();
      const pill = screen.getByText("Onboard your agent");
      expect(onboardingTriggers()).toHaveLength(1);
      // BENEATH the ask chips: the populated asks precede the quiet pill.
      const chip = screen.getByText("Compare two runs");
      expect(renders_before(chip, pill)).toBe(true);
    });
  });

  describe("while the panel is open on a conversation", () => {
    beforeEach(() => {
      reachMock.mockReturnValue(POPULATED_REACH);
      langyState.isOpen = true;
      langyState.activeConversationId = "conv-open";
    });

    /** @scenario The field stands down while a conversation is open */
    it("offers the way back into that conversation instead of a field that starts one", () => {
      renderHero();

      expect(screen.queryByPlaceholderText("ask")).toBeNull();
      expect(screen.getByText("Continue your conversation")).toBeDefined();
      // Hidden in place, not unmounted: the row keeps its height.
      expect(screen.getByText("Compare two runs")).not.toBeVisible();
      // The onboarding route needs no conversation, so it stays.
      expect(screen.getByText("Onboard your agent")).toBeDefined();
    });

    /** @scenario The field stands down while a conversation is open */
    it("opens the panel and puts the cursor in its composer", () => {
      const panel = document.createElement("div");
      panel.setAttribute("data-langy-composer", "panel");
      const textarea = document.createElement("textarea");
      panel.appendChild(textarea);
      document.body.appendChild(panel);
      try {
        renderHero();

        fireEvent.click(screen.getByText("Continue your conversation"));

        expect(langyState.openPanel).toHaveBeenCalledTimes(1);
        expect(langyState.askLangy).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(textarea);
      } finally {
        panel.remove();
      }
    });

    it("keeps the field while the panel is open on nothing", () => {
      langyState.activeConversationId = null;
      renderHero();

      expect(screen.getByPlaceholderText("ask")).toBeDefined();
      expect(screen.queryByText("Continue your conversation")).toBeNull();
      expect(screen.getByText("Compare two runs")).toBeVisible();
    });
  });

  describe("while a question handed to Langy is still on its way", () => {
    /** @scenario The field stands down while a conversation is open */
    it("stands down the same way, before the conversation has an id", () => {
      reachMock.mockReturnValue(POPULATED_REACH);
      langyState.pendingPrompt = "why are my traces failing";
      renderHero();

      expect(screen.queryByPlaceholderText("ask")).toBeNull();
      expect(screen.getByText("Continue your conversation")).toBeDefined();
    });
  });

  describe("while the project's reach is still unknown", () => {
    it("offers no onboarding control rather than one that swaps", () => {
      reachMock.mockReturnValue({
        isLoading: true,
        isNewProject: false,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      });
      renderHero();

      expect(screen.queryByText("Send your first trace")).toBeNull();
      expect(screen.queryByText("Onboard your agent")).toBeNull();
      expect(onboardingTriggers()).toHaveLength(0);
    });
  });
});
