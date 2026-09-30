/**
 * @vitest-environment jsdom
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
const onSavedMock = vi.fn();
const skipMock = vi.fn().mockResolvedValue(undefined);

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

vi.mock("../../../behavior/use-guided-provider-connect.ts", () => ({
  useGuidedProviderConnect: () => ({ onSaved: onSavedMock, skip: skipMock, isSaving: false }),
}));

vi.mock("../../../../../behavior/lent-edit-model-provider-form.tsx", () => ({
  LentEditModelProviderForm: ({
    providerKey,
    onSaved,
  }: {
    providerKey: string;
    onSaved: (saved: { chatModel?: string }) => Promise<void>;
  }) => (
    <div data-testid="stub-form">
      {providerKey}
      <button type="button" onClick={() => void onSaved({ chatModel: "m" })}>
        stub-save
      </button>
    </div>
  ),
}));

import { ProviderScreen } from "../provider-screen.tsx";

function renderScreen(onSkip = vi.fn(), picksCount = 1) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProviderScreen
        picksCount={picksCount}
        organizationId="org_1"
        projectId="project_1"
        fading={false}
        onConnected={vi.fn()}
        onSkip={onSkip}
      />
    </ChakraProvider>,
  );
}

describe("ProviderScreen", () => {
  beforeEach(() => {
    emitMock.mockClear();
    onSavedMock.mockClear();
    skipMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("types the line and announces the screen was viewed", async () => {
    renderScreen();
    await waitFor(
      () => expect(screen.getByTestId("provider-line")).toHaveTextContent(/connect an AI provider/),
      { timeout: 8000 },
    );
    expect(emitMock).toHaveBeenCalledWith("viewed", "provider");
  }, 10000);

  it("offers the marks as one radio group with the first provider checked", () => {
    renderScreen();
    // The connect area stays aria-hidden until the line finishes typing.
    const group = screen.getByRole("radiogroup", { name: "AI provider", hidden: true });
    const marks = within(group).getAllByRole("radio", { hidden: true });
    expect(marks[0]).toHaveAttribute("aria-checked", "true");
    expect(marks[1]).toHaveAttribute("aria-checked", "false");
  });

  it("reports a failed save as a failed provider event", async () => {
    onSavedMock.mockRejectedValueOnce(new Error("nope"));
    renderScreen();
    screen.getByText("stub-save").click();
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith("failed", "provider", {
        provider: "openai_codex",
        code: "save_failed",
      }),
    );
  });

  it("switches the credential panel to the picked provider", async () => {
    renderScreen();
    screen.getByText("Anthropic").click();
    expect(emitMock).toHaveBeenCalledWith("selected", "provider", { provider: "anthropic" });
    await waitFor(() => expect(screen.getByTestId("stub-form")).toHaveTextContent("anthropic"));
  });

  it("asks before skipping, then records the skip and calls onSkip", async () => {
    const onSkip = vi.fn();
    renderScreen(onSkip);
    screen.getByText("Skip Guided Tour").click();
    expect(await screen.findByText("Skip anyway")).toBeInTheDocument();
    screen.getByText("Skip anyway").click();
    await waitFor(() => expect(skipMock).toHaveBeenCalled());
    await waitFor(() => expect(onSkip).toHaveBeenCalled());
  });

  /** @scenario Langy says "that up" for one pick and "those up" for several */
  it("says that up for one pick and those up for several", async () => {
    const { unmount } = renderScreen(vi.fn(), 1);
    await waitFor(
      () =>
        expect(screen.getByTestId("provider-line")).toHaveTextContent(
          "Awesome! I'll help you set that up.",
        ),
      { timeout: 8000 },
    );
    unmount();
    renderScreen(vi.fn(), 2);
    await waitFor(
      () =>
        expect(screen.getByTestId("provider-line")).toHaveTextContent(
          "Awesome! I'll help you set those up.",
        ),
      { timeout: 8000 },
    );
  }, 20000);

  /** @scenario "Skip Guided Tour asks the user to confirm" */
  it("asks once, with the two choices", async () => {
    renderScreen();
    screen.getByText("Skip Guided Tour").click();
    const dialog = await screen.findByRole("dialog");
    expect(emitMock).toHaveBeenCalledWith("clicked", "skip_tour");
    expect(dialog).toHaveTextContent("Are you sure sure?");
    expect(dialog).toHaveTextContent("It's much easier to get Langy to setup everything for you.");
    expect(within(dialog).getByText("Skip anyway")).toBeInTheDocument();
    expect(within(dialog).getByText("Keep the guide")).toBeInTheDocument();
  });

  /** @scenario "Keep the guide closes the dialog" */
  it("keeps the guide and closes the dialog", async () => {
    const onSkip = vi.fn();
    renderScreen(onSkip);
    screen.getByText("Skip Guided Tour").click();
    const dialog = await screen.findByRole("dialog");
    within(dialog).getByText("Keep the guide").click();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSkip).not.toHaveBeenCalled();
    expect(skipMock).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith("confirmed", "kept_guide");
    expect(screen.getByTestId("provider-line")).toBeInTheDocument();
  });
});
