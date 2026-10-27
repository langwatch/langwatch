/**
 * @vitest-environment jsdom
 * The takeover's three real screens, in the order a reader meets them, over one analytics emitter.
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
const recordProvider = vi.fn().mockResolvedValue(undefined);
const recordProviderSkipped = vi.fn().mockResolvedValue(undefined);
const TYPED_API_KEY = "sk-typed-into-the-form-0123456789";

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

vi.mock("../../../../../behavior/onboarding-api.ts", () => ({
  onboardingApi: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: () => ({ refetch: async () => ({ data: {} }) }),
      },
      setRoleAssignmentForScope: { useMutation: () => ({ mutateAsync: async () => undefined }) },
    },
    onboarding: {
      recordProvider: { useMutation: () => ({ mutateAsync: recordProvider, isPending: false }) },
      recordProviderSkipped: {
        useMutation: () => ({ mutateAsync: recordProviderSkipped, isPending: false }),
      },
    },
  },
}));

vi.mock("../../../../../behavior/lent-edit-model-provider-form.tsx", () => ({
  LentEditModelProviderForm: ({
    onSaved,
  }: {
    onSaved: (saved: { chatModel?: string; apiKey?: string }) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() => void onSaved({ chatModel: "gpt-5", apiKey: TYPED_API_KEY })}
    >
      stub-save
    </button>
  ),
}));

import { HelloScreen } from "../hello-screen.tsx";
import { ProviderScreen } from "../provider-screen.tsx";
import { ValueScreen } from "../value-screen.tsx";

afterEach(cleanup);

function inDesignSystem(children: React.ReactNode) {
  return render(<DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>);
}

describe("the takeover's analytics", () => {
  beforeEach(() => {
    emitMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a reader goes through hello, value and provider", () => {
    /** @scenario The takeover reports its steps without ever carrying a key */
    it("reports each step with its screen, paths and provider, and no event carries the key", async () => {
      const hello = inDesignSystem(<HelloScreen firstName="Ada" fading={false} onNext={vi.fn()} />);
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      fireEvent.click(screen.getByTestId("takeover-next"));
      hello.unmount();

      const value = inDesignSystem(
        <ValueScreen firstName="Ada" target="ACME" fading={false} onNext={vi.fn()} />,
      );
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      fireEvent.click(screen.getByRole("button", { name: "Gateway" }));
      fireEvent.click(screen.getByTestId("takeover-next"));
      value.unmount();

      vi.useRealTimers();
      inDesignSystem(
        <ProviderScreen
          picksCount={1}
          organizationId="org_1"
          projectId="project_1"
          fading={false}
          onConnected={vi.fn()}
          onSkip={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("stub-save"));
      await waitFor(() => expect(recordProvider).toHaveBeenCalled());
      fireEvent.click(screen.getByText("Skip Guided Tour"));
      fireEvent.click(await screen.findByText("Skip anyway"));
      await waitFor(() => expect(recordProviderSkipped).toHaveBeenCalled());

      expect(emitMock).toHaveBeenCalledWith("viewed", "hello");
      expect(emitMock).toHaveBeenCalledWith("clicked", "next", { screen: "hello" });
      expect(emitMock).toHaveBeenCalledWith("viewed", "value");
      expect(emitMock).toHaveBeenCalledWith("selected", "path", { path: "gateway", order: 1 });
      expect(emitMock).toHaveBeenCalledWith("clicked", "next", {
        screen: "value",
        paths: ["gateway"],
      });
      expect(emitMock).toHaveBeenCalledWith("viewed", "provider");
      expect(emitMock).toHaveBeenCalledWith(
        "connected",
        "provider",
        expect.objectContaining({ provider: "openai_codex", model: "gpt-5" }),
      );
      expect(emitMock).toHaveBeenCalledWith("clicked", "skip_tour");
      expect(emitMock).toHaveBeenCalledWith("confirmed", "skip_tour");
      expect(JSON.stringify(emitMock.mock.calls)).not.toContain(TYPED_API_KEY);
    });
  });
});
