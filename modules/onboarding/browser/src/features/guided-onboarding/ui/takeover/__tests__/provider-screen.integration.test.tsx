/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@langwatch/model-provider-browser/edit-model-provider-form", () => ({
  EditModelProviderForm: ({ providerKey }: { providerKey: string }) => (
    <div data-testid="stub-form">{providerKey}</div>
  ),
}));

import { ProviderScreen } from "../provider-screen.tsx";

function renderScreen(onSkip = vi.fn()) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProviderScreen
        picksCount={1}
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

  /** @scenario "the provider screen types its line and announces it was viewed" */
  it("types the line and announces the screen was viewed", async () => {
    renderScreen();
    await waitFor(
      () => expect(screen.getByTestId("provider-line")).toHaveTextContent(/connect an AI provider/),
      { timeout: 8000 },
    );
    expect(emitMock).toHaveBeenCalledWith("viewed", "provider");
  }, 10000);

  /** @scenario "picking a mark switches the connect panel to that provider" */
  it("switches the credential panel to the picked provider", async () => {
    renderScreen();
    screen.getByText("Anthropic").click();
    expect(emitMock).toHaveBeenCalledWith("selected", "provider", { provider: "anthropic" });
    await waitFor(() => expect(screen.getByTestId("stub-form")).toHaveTextContent("anthropic"));
  });

  /** @scenario "skip guided tour asks once before letting go" */
  it("asks before skipping, then records the skip and calls onSkip", async () => {
    const onSkip = vi.fn();
    renderScreen(onSkip);
    screen.getByText("Skip Guided Tour").click();
    expect(await screen.findByText("Skip anyway")).toBeInTheDocument();
    screen.getByText("Skip anyway").click();
    await waitFor(() => expect(skipMock).toHaveBeenCalled());
    await waitFor(() => expect(onSkip).toHaveBeenCalled());
  });
});
