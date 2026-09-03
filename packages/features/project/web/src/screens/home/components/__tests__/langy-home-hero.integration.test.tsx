/**
 * @vitest-environment jsdom
 *
 * The hero's onboarding control: a new project leads with a prominent
 * "Send your first trace" above the ask chips, a populated project keeps the
 * quiet "Onboard your agent" beneath them.
 *
 * Ported from platform/app/src/components/home/__tests__/LangyHomeHero.integration.test.tsx
 * (origin/main), adapted from the deleted `~/features/command-bar/*`,
 * `~/features/langy/*` and `~/hooks/useOrganizationTeamProject` mocks to
 * `@langwatch/navigation-web/command-bar`, `@langwatch/langy-web` and
 * `ProjectHomeHostProvider`. See specs/home/langy-home.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/navigation-web/command-bar", () => ({
  CommandPalette: () => <input placeholder="ask" />,
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));

const askLangy = vi.fn();
vi.mock("@langwatch/langy-web", () => ({
  useLangyStore: (selector: (s: { askLangy: () => void }) => unknown) =>
    selector({ askLangy }),
  selectLangySuggestions: ({ reach }: { reach: { hasTraces: boolean } }) =>
    reach.hasTraces
      ? [{ label: "Compare two runs", icon: () => null, prompt: "compare two runs" }]
      : [{ label: "Show me around", icon: () => null, prompt: "show me around" }],
}));

// AgentActionsMenu (trace/web) reaches a tRPC-backed skill-prompt query this
// test does not exercise — the menu never opens in these two scenarios, only
// its trigger's own label and ordering are asserted.
vi.mock("@langwatch/trace-web/components/SetupWithAgentButton", () => ({
  AgentActionsMenu: ({ trigger }: { trigger: React.ReactNode }) => trigger,
  setupAgentPrompt: () => "",
}));

vi.mock("../dev/home-dev-state", () => ({ useHomeDevState: () => null }));
vi.mock("../welcome-header", () => ({ WelcomeHeader: () => <div>Good morning</div> }));

const reachMock = vi.fn();
vi.mock("../use-project-reach", () => ({ useProjectReach: () => reachMock() }));

import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeProject,
} from "../../../../model/project-home-host";
import { LangyHomeHero } from "../langy-home-hero";

class StubProjectHomeHost extends ProjectHomeHostPort {
  constructor(private readonly canAsk: boolean = true) {
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
  featureFlag() {
    return { enabled: false, isLoading: false };
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
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost(canAsk)}>
        <LangyHomeHero />
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );
}

const onboardingTriggers = () =>
  screen.queryAllByRole("button").filter((b) => b.getAttribute("aria-haspopup") === "menu");

/** True when `a` comes before `b` in the document. */
const renders_before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

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

      expect(
        screen.getByText(/ask whoever manages your account for access/i),
      ).toBeDefined();
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
