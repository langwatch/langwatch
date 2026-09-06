/**
 * @vitest-environment jsdom
 *
 * The takeover's phases and what each one writes: the picks are recorded on
 * the way to the provider screen, the provider connect or the skip lands
 * the user on the first pick's page, a pending continuation wins.
 *
 * The screens themselves are stubs here; each has its own test.
 *
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: React.ReactNode }) => children,
  useAnalytics: () => ({ emit: vi.fn() }),
}));

vi.mock("../HelloScreen", () => ({
  HelloScreen: ({
    firstName,
    onNext,
  }: {
    firstName: string;
    onNext: () => void;
  }) => (
    <div data-testid="hello-stub">
      hello {firstName}
      <button type="button" onClick={onNext}>
        hello-next
      </button>
    </div>
  ),
}));

vi.mock("../ValueScreen", () => ({
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

vi.mock("../ProviderScreen", () => ({
  ProviderScreen: ({
    picksCount,
    onConnected,
    onSkip,
  }: {
    picksCount: number;
    onConnected: (c: unknown) => void;
    onSkip: () => void;
  }) => (
    <div data-testid="provider-stub" data-picks-count={picksCount}>
      <button
        type="button"
        onClick={() =>
          onConnected({ provider: "openai", model: "gpt-5.2", kind: "api-key" })
        }
      >
        provider-connect
      </button>
      <button type="button" onClick={onSkip}>
        provider-skip
      </button>
    </div>
  ),
}));

// The landing is a full navigation; the stub records where it went.
vi.mock("../navigate", () => ({
  navigateTo: (href: string) => {
    location.href = href;
  },
}));

const showErrorToast = vi.fn();
vi.mock("~/features/errors", () => ({
  showErrorToast: (args: unknown) => showErrorToast(args),
}));

type MutateOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
};
const recordPaths = vi.fn<(input: unknown, options: MutateOptions) => void>();
const recordProviderSkipped =
  vi.fn<(input: unknown, options: MutateOptions) => void>();
vi.mock("~/utils/api", () => ({
  api: {
    onboarding: {
      recordPaths: {
        useMutation: () => ({ mutate: recordPaths, isPending: false }),
      },
      recordProviderSkipped: {
        useMutation: () => ({
          mutate: recordProviderSkipped,
          isPending: false,
        }),
      },
    },
  },
}));

import { GuidedTakeover } from "../GuidedTakeover";
import type { TakeoverPhase } from "../resume";

afterEach(cleanup);

const location = { href: "" };

function renderTakeover({
  initialPhase = "hello",
  initialPaths,
  returnTo = null,
}: {
  initialPhase?: TakeoverPhase;
  initialPaths?: ("llmops" | "coding" | "gateway" | "governance")[];
  returnTo?: string | null;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GuidedTakeover
        organizationId="org_1"
        organizationName="ACME"
        projectId="proj_1"
        projectSlug="acme-proj"
        userName="Rogerio Chaves"
        usageStyle="For my company"
        initialPhase={initialPhase}
        initialPaths={initialPaths}
        returnTo={returnTo}
      />
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
    recordProviderSkipped.mockReset();
    showErrorToast.mockReset();
    location.href = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the greeting is done", () => {
    it("fades into the value question addressed to the organization", () => {
      renderTakeover();
      expect(screen.getByTestId("hello-stub")).toHaveTextContent(
        "hello Rogerio",
      );
      fireEvent.click(screen.getByText("hello-next"));
      expect(screen.getByTestId("hello-stub")).toBeInTheDocument();
      fade();
      expect(screen.getByTestId("value-stub")).toHaveTextContent(
        "value for ACME",
      );
    });
  });

  describe("when the picks are made", () => {
    /** @scenario "Leaving the value screen records the picks in order" */
    it("records the paths in pick order and opens the provider screen", () => {
      recordPaths.mockImplementation((_input, options) =>
        options.onSuccess?.({}),
      );
      renderTakeover({ initialPhase: "value" });
      fireEvent.click(screen.getByText("value-next"));
      expect(recordPaths).toHaveBeenCalledWith(
        { organizationId: "org_1", paths: ["gateway", "llmops"] },
        expect.anything(),
      );
      fade();
      expect(screen.getByTestId("provider-stub")).toHaveAttribute(
        "data-picks-count",
        "2",
      );
    });

    /** @scenario "A failed record keeps the user on the value screen" */
    it("shows the named error and stays on the value screen with the picks", () => {
      recordPaths.mockImplementation((_input, options) =>
        options.onError?.(new Error("nope")),
      );
      renderTakeover({ initialPhase: "value" });
      fireEvent.click(screen.getByText("value-next"));
      fade();
      expect(showErrorToast).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackTitle: "Couldn't save what you picked",
        }),
      );
      expect(screen.getByTestId("value-stub")).toHaveAttribute(
        "data-picks",
        "gateway,llmops",
      );
      expect(screen.queryByTestId("provider-stub")).not.toBeInTheDocument();
    });
  });

  describe("when the provider connects", () => {
    /** @scenario "Connecting a provider lands the user on the first pick" */
    it("lands on the first pick's page", () => {
      renderTakeover({
        initialPhase: "provider",
        initialPaths: ["gateway", "llmops"],
      });
      fireEvent.click(screen.getByText("provider-connect"));
      expect(location.href).toBe("");
      fade();
      expect(location.href).toBe("/gateway");
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
      expect(location.href).toBe("/cli/auth?user_code=ABCD");
    });
  });

  describe("when the user skips the guide", () => {
    /** @scenario "Skip anyway records the skip and lands the user on the first pick" */
    it("records the skip on the organization and lands on the first pick", () => {
      recordProviderSkipped.mockImplementation((_input, options) =>
        options.onSuccess?.({}),
      );
      renderTakeover({
        initialPhase: "provider",
        initialPaths: ["governance"],
      });
      fireEvent.click(screen.getByText("provider-skip"));
      expect(recordProviderSkipped).toHaveBeenCalledWith(
        { organizationId: "org_1" },
        expect.anything(),
      );
      expect(location.href).toBe("/governance");
    });

    it("lands on the traces page when nothing was picked", () => {
      recordProviderSkipped.mockImplementation((_input, options) =>
        options.onSuccess?.({}),
      );
      renderTakeover({ initialPhase: "provider" });
      fireEvent.click(screen.getByText("provider-skip"));
      expect(location.href).toBe("/acme-proj/traces");
    });
  });
});
