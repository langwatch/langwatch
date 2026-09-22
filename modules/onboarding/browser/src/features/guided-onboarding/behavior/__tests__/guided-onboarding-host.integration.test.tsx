/**
 * @vitest-environment jsdom
 * @see specs/features/onboarding/guided-tour.feature
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidateGuidedState = vi.fn();
const recordTourMutate = vi.fn();
let recordTourOnSuccess: (() => void) | undefined;

vi.mock("../../../../behavior/onboarding-api.ts", () => ({
  onboardingApi: {
    useUtils: () => ({ onboarding: { getGuidedState: { invalidate: invalidateGuidedState } } }),
    onboarding: {
      recordTour: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          recordTourOnSuccess = opts.onSuccess;
          return { mutate: recordTourMutate, isPending: false };
        },
      },
    },
  },
}));

let guidedView: {
  guided: boolean;
  state: Record<string, unknown> | null;
  organizationId: string | null;
  variant?: "guided" | "classic" | null;
};

vi.mock("../use-guided-onboarding.ts", () => ({
  useGuidedOnboarding: () => guidedView,
}));

vi.mock("../../ui/tour/tour-layer.tsx", () => ({
  TourLayer: () => <div data-testid="tour-layer" />,
}));

const { mockRegisterOnboardingExperiment } = vi.hoisted(() => ({
  mockRegisterOnboardingExperiment: vi.fn(),
}));

vi.mock("../../../../behavior/onboarding-experiment-registration.ts", () => ({
  registerOnboardingExperiment: mockRegisterOnboardingExperiment,
}));

import {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingActor,
  type OnboardingFlagReading,
  type OnboardingGovernanceCapability,
  type OnboardingLangyCapability,
  type OnboardingRouteReading,
  type OnboardingScope,
  type OnboardingSidebarCapability,
} from "../../../../model/onboarding-host.ts";
import { GuidedOnboardingHost } from "../guided-onboarding-host.tsx";
import { useGuidedTourStore } from "../guided-tour-store.ts";

class TestOnboardingHost extends OnboardingHostApi {
  langyDock = vi.fn();
  langyQueueKickoff = vi.fn();
  sidebarExpand = vi.fn();
  sidebarCollapse = vi.fn();
  sidebarRestoreAll = vi.fn();
  governanceSetSampleChoice = vi.fn();

  constructor(private readonly opts: { pathname: string; organizationId: string | null }) {
    super();
  }

  scope(): OnboardingScope {
    return {
      organization: this.opts.organizationId
        ? { id: this.opts.organizationId, name: "Acme", primaryIntent: null, teams: [] }
        : undefined,
      organizations: [],
      project: undefined,
      isLoading: false,
    };
  }
  currentUser(): OnboardingActor {
    return { id: "user_1", email: "ada@example.com", name: "Ada Lovelace" };
  }
  sessionStatus() {
    return "authenticated" as const;
  }
  route(): OnboardingRouteReading {
    return { pathname: this.opts.pathname, asPath: this.opts.pathname, params: {}, query: {} };
  }
  navigate() {}
  replace() {}
  hardRedirect() {}
  setQuery() {}
  featureFlag(): OnboardingFlagReading {
    return { enabled: true, isLoading: false };
  }
  signOut() {}
  succeeded() {}
  failed() {}
  async copyToClipboard() {
    return true;
  }
  revealProjectApiKey() {
    return undefined;
  }
  prefersReducedMotion() {
    return false;
  }
  langy(): OnboardingLangyCapability {
    return {
      dock: this.langyDock,
      queueKickoff: this.langyQueueKickoff,
      onScopeAnnounced: (_organizationId, callback) => {
        callback();
        return () => undefined;
      },
    };
  }
  sidebar(): OnboardingSidebarCapability {
    return {
      expandGroup: this.sidebarExpand,
      collapseGroup: this.sidebarCollapse,
      restoreAll: this.sidebarRestoreAll,
    };
  }
  governance(): OnboardingGovernanceCapability {
    return { setSampleChoice: this.governanceSetSampleChoice };
  }
}

function mount(host: TestOnboardingHost) {
  return render(
    <OnboardingHostProvider value={host}>
      <GuidedOnboardingHost />
    </OnboardingHostProvider>,
  );
}

function guidedState(overrides: Record<string, unknown> = {}) {
  return { paths: [], donePaths: [], variant: "guided" as const, ...overrides };
}

describe("GuidedOnboardingHost", () => {
  beforeEach(() => {
    recordTourMutate.mockClear();
    invalidateGuidedState.mockClear();
    mockRegisterOnboardingExperiment.mockClear();
    recordTourOnSuccess = undefined;
    useGuidedTourStore.setState({
      running: false,
      path: null,
      stepIndex: 0,
      handoff: null,
      runId: 0,
      onEnd: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  /** @scenario "the tour never runs on the onboarding screens" */
  it("does nothing while the page is under /onboarding", () => {
    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "gateway" }),
      organizationId: "org_1",
    };
    const host = new TestOnboardingHost({
      pathname: "/onboarding/welcome",
      organizationId: "org_1",
    });
    const { queryByTestId } = mount(host);
    expect(queryByTestId("tour-layer")).toBeNull();
    expect(host.langyDock).not.toHaveBeenCalled();
  });

  /** @scenario "the classic variant never runs the tour" */
  it("does nothing when the organization is not in the guided variant", () => {
    guidedView = { guided: false, state: null, organizationId: "org_1" };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    const { queryByTestId } = mount(host);
    expect(queryByTestId("tour-layer")).toBeNull();
    expect(host.langyDock).not.toHaveBeenCalled();
  });

  /** @scenario "the host opens the panel docked before the tour starts" */
  it("docks the panel and starts the tour for a path that has one", () => {
    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "gateway" }),
      organizationId: "org_1",
    };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    mount(host);
    expect(host.langyDock).toHaveBeenCalledTimes(1);
    expect(useGuidedTourStore.getState().running).toBe(true);
    expect(useGuidedTourStore.getState().path).toBe("gateway");
  });

  /** @scenario "the kickoff is queued exactly once when the tour ends" */
  it("records the tour outcome and queues the kickoff once it ends", () => {
    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "gateway" }),
      organizationId: "org_1",
    };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    mount(host);

    useGuidedTourStore.getState().end("completed");

    expect(recordTourMutate).toHaveBeenCalledWith({ organizationId: "org_1", status: "completed" });
    expect(host.langyQueueKickoff).toHaveBeenCalledTimes(1);
    expect(host.langyQueueKickoff).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "gateway",
        orgName: "Acme",
        firstName: "Ada",
        tourStatus: "completed",
      }),
    );

    recordTourOnSuccess?.();
    expect(invalidateGuidedState).toHaveBeenCalledWith({ organizationId: "org_1" });
  });

  /** @scenario "the coding path queues the kickoff with no tour" */
  it("queues the kickoff straight away for a path with no tour", () => {
    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "coding" }),
      organizationId: "org_1",
    };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    mount(host);

    expect(host.langyDock).toHaveBeenCalledTimes(1);
    expect(useGuidedTourStore.getState().running).toBe(false);
    expect(host.langyQueueKickoff).toHaveBeenCalledWith(
      expect.objectContaining({ path: "coding", tourStatus: "none" }),
    );
  });

  /** @scenario "the tour never runs twice for the same path" */
  it("lands the current path once per mount, even across re-renders", () => {
    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "coding" }),
      organizationId: "org_1",
    };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    const { rerender } = mount(host);
    expect(host.langyDock).toHaveBeenCalledTimes(1);

    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "coding" }),
      organizationId: "org_1",
    };
    rerender(
      <OnboardingHostProvider value={host}>
        <GuidedOnboardingHost />
      </OnboardingHostProvider>,
    );

    expect(host.langyDock).toHaveBeenCalledTimes(1);
  });

  /** @scenario "the governance tour shows sample data on every page it visits and turns it off when it ends" */
  it("turns the sample panels off if the host unmounts while the governance tour runs", () => {
    guidedView = {
      guided: true,
      state: guidedState({ currentPath: "governance" }),
      organizationId: "org_1",
    };
    const host = new TestOnboardingHost({ pathname: "/governance/costs", organizationId: "org_1" });
    const { unmount } = mount(host);
    expect(useGuidedTourStore.getState().running).toBe(true);

    unmount();

    expect(host.governanceSetSampleChoice).toHaveBeenCalledWith(false);
  });

  /** @scenario "the browser registers the experiment property once the organization's variant is known" */
  it("wires the experiment registration to the organization's variant", () => {
    guidedView = { guided: false, state: null, organizationId: "org_1", variant: "guided" };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    mount(host);

    expect(mockRegisterOnboardingExperiment).toHaveBeenCalledWith("guided");
  });

  /** @scenario "the browser registers nothing for an organization without a variant" */
  it("wires no-variant through to the registration the same way", () => {
    guidedView = { guided: false, state: null, organizationId: "org_1", variant: null };
    const host = new TestOnboardingHost({
      pathname: "/project/p1/traces",
      organizationId: "org_1",
    });
    mount(host);

    expect(mockRegisterOnboardingExperiment).toHaveBeenCalledWith(null);
  });
});
