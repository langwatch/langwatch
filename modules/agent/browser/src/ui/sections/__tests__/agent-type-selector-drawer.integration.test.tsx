/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawer = vi.hoisted(() => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }));

vi.mock(
  "../../../behavior/agent-api.ts",
  async () =>
    (
      await import("../../../features/voice-editor/ui/sections/__tests__/voice-editor-doubles.test-helpers.tsx")
    ).agentApiDouble,
);

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ ...drawer, canGoBack: false, goBack: vi.fn() }),
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { AgentTypeSelectorDrawer } = await import("../agent-type-selector-drawer.tsx");
const { voiceState } =
  await import("../../../features/voice-editor/ui/sections/__tests__/voice-editor-doubles.test-helpers.tsx");
const { VoiceTestHost, resetVoiceState } =
  await import("../../../features/voice-editor/ui/sections/__tests__/voice-editor.test-helpers.tsx");
const { AgentManagementHostProvider } = await import("../../../model/agent-management-host.ts");

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <AgentManagementHostProvider value={new VoiceTestHost()}>
      {children}
    </AgentManagementHostProvider>
  </ChakraProvider>
);

beforeEach(resetVoiceState);

afterEach(() => {
  cleanup();
  drawer.openDrawer.mockReset();
});

function renderDrawer(onSelect = vi.fn()) {
  return {
    onSelect,
    ...render(<AgentTypeSelectorDrawer open={true} onClose={vi.fn()} onSelect={onSelect} />, {
      wrapper: Wrapper,
    }),
  };
}

describe("AgentTypeSelectorDrawer", () => {
  /** @scenario "Agent types available" */
  /** @scenario "AgentTypeSelectorDrawer shows two options" */
  it("renders the available agent types", () => {
    renderDrawer();

    expect(screen.getByText("Choose Agent Connection Type")).toBeTruthy();
    expect(screen.getByText("Code Agent")).toBeTruthy();
    expect(screen.getByText("Workflow Agent")).toBeTruthy();
    expect(screen.getByText("HTTP Agent")).toBeTruthy();
    expect(screen.queryByText("Prompt Agent")).toBeNull();
  });

  it("reports the selected type", async () => {
    const { onSelect } = renderDrawer();

    fireEvent.click(screen.getByTestId("agent-type-code"));

    expect(onSelect).toHaveBeenCalledWith("code");
  });

  it("reports workflow selection", async () => {
    const { onSelect } = renderDrawer();

    fireEvent.click(screen.getByTestId("agent-type-workflow"));

    expect(onSelect).toHaveBeenCalledWith("workflow");
  });

  describe("given the release_voice_agents_enabled flag", () => {
    /** @scenario "The new agent flow offers a Voice Agent while the flag is on" */
    it("offers a Voice Agent card between HTTP and Code while it is on", () => {
      renderDrawer();

      expect(screen.getByText("Voice Agent")).toBeTruthy();
      const types = screen.getAllByTestId(/^agent-type-[a-z]+$/).map((card) => card.dataset.testid);
      expect(types).toEqual([
        "agent-type-connected",
        "agent-type-http",
        "agent-type-voice",
        "agent-type-code",
        "agent-type-workflow",
      ]);
    });

    /** @scenario "The new agent flow offers a Voice Agent while the flag is on" */
    it("opens the voice editor when the Voice Agent card is chosen", () => {
      render(<AgentTypeSelectorDrawer open />, { wrapper: Wrapper });
      fireEvent.click(screen.getByTestId("agent-type-voice"));

      expect(drawer.openDrawer).toHaveBeenCalledWith("agentVoiceEditor");
    });

    /** @scenario "The new agent flow hides the Voice Agent while the flag is off" */
    /** @scenario "The Voice Agent option is hidden while the project's flag is off" */
    it("hides the Voice Agent card while it is off", () => {
      voiceState.flagOn = false;
      renderDrawer();

      expect(screen.queryByTestId("agent-type-voice")).toBeNull();
    });
  });

  describe("given the connect-from-code choice leads the list", () => {
    /** @scenario "Connect from code is the first choice of the new agent flow" */
    it("draws Connect from Code first, with the green dot before the words", () => {
      render(
        <AgentTypeSelectorDrawer open={true} onClose={vi.fn()} onConnectFromCode={vi.fn()} />,
        { wrapper: Wrapper },
      );

      const cards = screen.getAllByTestId(/^agent-type-/);
      expect(cards[0]).toHaveAttribute("data-testid", "agent-type-connected");
      expect(screen.getByTestId("agent-type-connected-dot")).toBeTruthy();
      expect(screen.getByText("Connect from Code")).toBeTruthy();
    });

    /** @scenario "Connect from code opens the connect drawer" */
    it("calls onConnectFromCode when clicked, without selecting a stored type", () => {
      const onConnectFromCode = vi.fn();
      const { onSelect } = {
        onSelect: vi.fn(),
      };
      render(
        <AgentTypeSelectorDrawer
          open={true}
          onClose={vi.fn()}
          onSelect={onSelect}
          onConnectFromCode={onConnectFromCode}
        />,
        { wrapper: Wrapper },
      );

      fireEvent.click(screen.getByTestId("agent-type-connected"));

      expect(onConnectFromCode).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("given the Edit Scenario drawer opened the selector by address", () => {
    const openedByAddress = () => render(<AgentTypeSelectorDrawer open />, { wrapper: Wrapper });

    it("navigates to the HTTP editor when HTTP Agent is chosen", () => {
      openedByAddress();
      fireEvent.click(screen.getByText("HTTP Agent"));

      expect(drawer.openDrawer).toHaveBeenCalledWith("agentHttpEditor");
    });

    it("navigates to the code editor when Code Agent is chosen", () => {
      openedByAddress();
      fireEvent.click(screen.getByText("Code Agent"));

      expect(drawer.openDrawer).toHaveBeenCalledWith("agentCodeEditor");
    });

    it("navigates to the workflow selector when Workflow Agent is chosen", () => {
      openedByAddress();
      fireEvent.click(screen.getByText("Workflow Agent"));

      expect(drawer.openDrawer).toHaveBeenCalledWith("workflowSelector");
    });

    it("navigates to the connect drawer from Connect from Code", () => {
      openedByAddress();
      fireEvent.click(screen.getByTestId("agent-type-connected"));

      expect(drawer.openDrawer).toHaveBeenCalledWith("agentConnectFromCode");
    });
  });
});
