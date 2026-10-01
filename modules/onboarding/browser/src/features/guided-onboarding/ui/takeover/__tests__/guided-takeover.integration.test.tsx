/**
 * @vitest-environment jsdom
 * The takeover's phases and its landing, over stub screens: the order, what is recorded on the
 * organization, and where the reader lands.
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { GuidedPath } from "@langwatch/onboarding-contract";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: ReactNode }) => children,
  useAnalytics: () => ({ emit: vi.fn() }),
}));

vi.mock("../hello-screen.tsx", () => ({
  HelloScreen: ({ firstName, onNext }: { firstName: string; onNext: () => void }) => (
    <div data-testid="hello-stub">
      hello {firstName}
      <button type="button" onClick={onNext}>
        hello-next
      </button>
    </div>
  ),
}));

vi.mock("../value-screen.tsx", () => ({
  ValueScreen: ({
    target,
    initialPicks,
    onNext,
  }: {
    target: string;
    initialPicks?: string[];
    onNext: (paths: string[]) => void;
  }) => (
    <div data-testid="value-stub" data-picks={(initialPicks ?? []).join(",")}>
      value for {target}
      <button type="button" onClick={() => onNext(["gateway", "llmops"])}>
        value-next
      </button>
    </div>
  ),
}));

vi.mock("../provider-screen.tsx", () => ({
  ProviderScreen: ({
    picksCount,
    onConnected,
    onSkip,
  }: {
    picksCount: number;
    onConnected: (connected: { provider: string; model: string }) => void;
    onSkip: () => void;
  }) => (
    <div data-testid="provider-stub" data-picks-count={picksCount}>
      <button type="button" onClick={() => onConnected({ provider: "openai", model: "gpt-5.2" })}>
        provider-connect
      </button>
      <button type="button" onClick={onSkip}>
        provider-skip
      </button>
    </div>
  ),
}));

type MutateOptions = { onSuccess?: (data: unknown) => void; onError?: (error: Error) => void };
const recordPaths = vi.fn<(input: unknown, options: MutateOptions) => void>();
vi.mock("../../../../../behavior/onboarding-api.ts", () => ({
  onboardingApi: {
    onboarding: {
      recordPaths: { useMutation: () => ({ mutate: recordPaths, isPending: false }) },
    },
  },
}));

import {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingFailureNotice,
  type OnboardingScope,
} from "../../../../../model/onboarding-host.ts";
import type { TakeoverPhase } from "../../../model/resume.ts";
import { GuidedTakeover } from "../guided-takeover.tsx";

const landedAt: string[] = [];
const failures: OnboardingFailureNotice[] = [];

class TakeoverTestHost extends OnboardingHostApi {
  scope(): OnboardingScope {
    return { organization: undefined, organizations: [], project: undefined, isLoading: false };
  }
  currentUser() {
    return null;
  }
  sessionStatus() {
    return "authenticated" as const;
  }
  route() {
    return {
      pathname: "/onboarding/welcome",
      asPath: "/onboarding/welcome",
      params: {},
      query: {},
    };
  }
  navigate() {}
  replace() {}
  hardRedirect(to: string) {
    landedAt.push(to);
  }
  setQuery() {}
  featureFlag() {
    return { enabled: true, isLoading: false };
  }
  signOut() {}
  succeeded() {}
  failed(failure: OnboardingFailureNotice) {
    failures.push(failure);
  }
  async copyToClipboard() {
    return true;
  }
  revealProjectApiKey() {
    return undefined;
  }
  prefersReducedMotion() {
    return true;
  }
  langy() {
    return { dock() {}, queueKickoff() {}, onScopeAnnounced: () => () => undefined };
  }
  sidebar() {
    return { expandGroup() {}, collapseGroup() {}, restoreAll() {} };
  }
  governance() {
    return { setSampleChoice() {} };
  }
  joinOffers() {
    return [];
  }
}

function renderTakeover({
  initialPhase = "hello",
  initialPaths,
  returnTo = null,
}: {
  initialPhase?: TakeoverPhase;
  initialPaths?: GuidedPath[];
  returnTo?: string | null;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <OnboardingHostProvider value={new TakeoverTestHost()}>
        <GuidedTakeover
          organizationId="org_1"
          organizationName="ACME"
          projectId="proj_1"
          projectSlug="acme-proj"
          userName="Rogerio Chaves"
          usageStyle="For my company"
          initialPhase={initialPhase}
          {...(initialPaths ? { initialPaths } : {})}
          returnTo={returnTo}
        />
      </OnboardingHostProvider>
    </ChakraProvider>,
  );
}

const fade = () =>
  act(() => {
    vi.advanceTimersByTime(600);
  });

describe("GuidedTakeover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordPaths.mockReset();
    landedAt.length = 0;
    failures.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("when the greeting is done", () => {
    it("fades into the value question addressed to the organization", () => {
      renderTakeover();
      expect(screen.getByTestId("hello-stub")).toHaveTextContent("hello Rogerio");
      fireEvent.click(screen.getByText("hello-next"));
      fade();
      expect(screen.getByTestId("value-stub")).toHaveTextContent("value for ACME");
    });
  });

  describe("when the picks are made", () => {
    /** @scenario "Leaving the value screen records the picks in order" */
    it("records the paths in pick order and opens the provider screen", () => {
      recordPaths.mockImplementation((_input, options) => options.onSuccess?.({}));
      renderTakeover({ initialPhase: "value" });
      fireEvent.click(screen.getByText("value-next"));
      expect(recordPaths).toHaveBeenCalledWith(
        { organizationId: "org_1", paths: ["gateway", "llmops"] },
        expect.anything(),
      );
      fade();
      expect(screen.getByTestId("provider-stub")).toHaveAttribute("data-picks-count", "2");
    });

    /** @scenario "A failed record keeps the user on the value screen" */
    it("reports the named failure and stays on the value screen with the picks", () => {
      recordPaths.mockImplementation((_input, options) => options.onError?.(new Error("nope")));
      renderTakeover({ initialPhase: "value" });
      fireEvent.click(screen.getByText("value-next"));
      fade();
      expect(failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't save what you picked" }),
      ]);
      expect(screen.getByTestId("value-stub")).toHaveAttribute("data-picks", "gateway,llmops");
      expect(screen.queryByTestId("provider-stub")).not.toBeInTheDocument();
    });
  });

  describe("when the provider connects", () => {
    /** @scenario "Connecting a provider lands the user on the first pick" */
    it("lands on the first pick's page", () => {
      renderTakeover({ initialPhase: "provider", initialPaths: ["gateway", "llmops"] });
      fireEvent.click(screen.getByText("provider-connect"));
      expect(landedAt).toEqual([]);
      fade();
      expect(landedAt).toEqual(["/gateway"]);
    });

    /** @scenario "A pending continuation wins over the landing" */
    it("goes to the continuation instead when one is pending", () => {
      renderTakeover({
        initialPhase: "provider",
        initialPaths: ["gateway"],
        returnTo: "/cli/auth?user_code=ABCD",
      });
      fireEvent.click(screen.getByText("provider-connect"));
      fade();
      expect(landedAt).toEqual(["/cli/auth?user_code=ABCD"]);
    });
  });

  describe("when the user skips the guide", () => {
    /** @scenario "Skip anyway records the skip and lands the user on the first pick" */
    it("lands on the first pick once the provider screen recorded the skip", () => {
      renderTakeover({ initialPhase: "provider", initialPaths: ["governance"] });
      fireEvent.click(screen.getByText("provider-skip"));
      expect(landedAt).toEqual(["/governance"]);
    });

    it("lands on the traces page when nothing was picked", () => {
      renderTakeover({ initialPhase: "provider" });
      fireEvent.click(screen.getByText("provider-skip"));
      expect(landedAt).toEqual(["/acme-proj/traces"]);
    });
  });
});
