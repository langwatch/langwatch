/**
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Trace's lent menu reaches a skill-prompt query these scenarios never open;
// only its trigger's own label and ordering are asserted.
vi.mock("../../../../../behavior/lent-peers.tsx", () => ({
  InlineCommandPalette: () => <input placeholder="ask" />,
  GuidedOnboardingOffer: () => null,
  AgentActionsMenu: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));

const langyState = {
  askLangy: vi.fn(),
  openPanel: vi.fn(),
  isOpen: false,
  activeConversationId: null as string | null,
  pendingPrompt: null as string | null,
};
vi.mock("@langwatch/design-system/langy-mark", () => ({ LangyMark: () => null }));

vi.mock("../../../../../behavior/langy/langy.store.ts", () => ({
  useLangyStore: (selector: (s: typeof langyState) => unknown) => selector(langyState),
}));

vi.mock("../../../langy/langy-home-suggestions.ts", () => ({
  selectLangySuggestions: ({ reach }: { reach: { hasTraces: boolean } }) =>
    reach.hasTraces
      ? [{ label: "Compare two runs", icon: () => null, prompt: "compare two runs" }]
      : [{ label: "Show me around", icon: () => null, prompt: "show me around" }],
}));

vi.mock("../welcome-header.tsx", () => ({ WelcomeHeader: () => <div>Good morning</div> }));

const reachMock = vi.fn();
vi.mock("../use-project-reach.ts", () => ({ useProjectReach: () => reachMock() }));

import {
  ProjectHomeHostProvider,
  ProjectHomeHost,
  type ProjectHomeProject,
} from "../../../../../model/project-home-host.ts";
import { LangyHomeHero } from "../langy-home-hero.tsx";

class StubProjectHomeHost extends ProjectHomeHost {
  constructor(private readonly canAsk = true) {
    super();
  }
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "My Project", slug: "my-project" };
  }
  organization() {
    return undefined;
  }
  currentUser() {
    return undefined;
  }
  isLoading(): boolean {
    return false;
  }
  hasPermission(): boolean {
    return true;
  }
  langyVisibility() {
    return { show: true, isResolving: false };
  }
  canAskLangy(): boolean {
    return this.canAsk;
  }
  deployment() {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return false;
  }
  navigate(): void {}
}

function renderHero(canAsk = true) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <ProjectHomeHostProvider value={new StubProjectHomeHost(canAsk)}>
        <LangyHomeHero />
      </ProjectHomeHostProvider>
    </DesignSystemProvider>,
  );
}

const onboardingTriggers = () =>
  screen.queryAllByRole("button").filter((b) => b.getAttribute("aria-haspopup") === "menu");

/** True when `a` comes before `b` in the document. */
const renders_before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  langyState.isOpen = false;
  langyState.activeConversationId = null;
  langyState.pendingPrompt = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});

describe("LangyHomeHero ask row", () => {
  describe("given a reader who may read Langy but not start conversations", () => {
    /** @scenario A reader who cannot start a conversation is not handed a composer */
    it("offers a line about access instead of asks to send", () => {
      reachMock.mockReturnValue(NEW_PROJECT_REACH);
      renderHero(false);

      expect(screen.getByText(/ask whoever manages your account for access/i)).toBeDefined();
      expect(screen.queryByText("Show me around")).toBeNull();
    });
  });

  describe("given the project's reach is not known yet", () => {
    /** @scenario The asks never change under the reader's hand */
    it("shows no example asks rather than ones it would have to withdraw", () => {
      reachMock.mockReturnValue({
        isLoading: true,
        isNewProject: false,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      });
      renderHero();

      // The field itself is always there; only the asks — which would have to
      // be withdrawn once the reach answer lands — wait for it.
      expect(screen.getByPlaceholderText("ask")).toBeDefined();
      expect(screen.queryByText("Show me around")).toBeNull();
      expect(screen.queryByText("Compare two runs")).toBeNull();
    });
  });
});

describe("LangyHomeHero while a conversation is open", () => {
  describe("given the panel is open on a conversation", () => {
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
      expect(screen.getByText("Compare two runs")).not.toBeVisible();
      expect(screen.getByText("Onboard your agent")).toBeDefined();
    });

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
    });
  });

  describe("given a question handed to Langy is still on its way", () => {
    /** @scenario The field stands down while a conversation is open */
    it("stands down the same way, before the conversation has an id", () => {
      reachMock.mockReturnValue(POPULATED_REACH);
      langyState.pendingPrompt = "why are my traces failing";
      renderHero();

      expect(screen.queryByPlaceholderText("ask")).toBeNull();
      expect(screen.getByText("Continue your conversation")).toBeDefined();
    });
  });
});
