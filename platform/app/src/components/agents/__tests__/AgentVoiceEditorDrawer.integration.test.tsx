/**
 * @vitest-environment jsdom
 *
 * Integration tests for AgentVoiceEditorDrawer.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The panel statically pulls the vendor client; the drawer test never opens it,
// so stub it to keep that SDK out of the drawer's import graph. A test that
// needs to simulate the panel reporting a created row clicks this button.
vi.mock("../voice/TalkToItPanel", () => ({
  TalkToItPanel: (props: { onAgentCreated?: (agentRowId: string) => void }) =>
    props.onAgentCreated ? (
      <button
        data-testid="mock-panel-created-row"
        onClick={() => props.onAgentCreated?.("agent_row_created")}
      >
        simulate created row
      </button>
    ) : null,
}));

import { AgentVoiceEditorDrawer } from "../AgentVoiceEditorDrawer";

// -- Transitive-dependency mocks (mirrors AgentHttpEditorDrawer.integration) --

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "test-user" } },
    status: "authenticated",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

/** Overridden per test via `mockVoiceAgentsEnabled`; true by default so the
 * editor's own behavior tests are unaffected by the flag gate. */
let mockVoiceAgentsEnabled = true;
vi.mock("../voice/useVoiceAgentsEnabled", () => ({
  useVoiceAgentsEnabled: () => mockVoiceAgentsEnabled,
}));

/** Overridden per test; false by default so the phone option stays gated off
 * for the editor's own behavior tests. */
let mockPhoneTargetsEnabled = false;
vi.mock("../voice/useVoicePhoneTargetsEnabled", () => ({
  useVoicePhoneTargetsEnabled: () => mockPhoneTargetsEnabled,
}));

/** What `agents.getById` answers with, so a test can open a saved agent. */
let mockAgentById: {
  id: string;
  name: string;
  config: Record<string, unknown>;
} | null = null;

/** The provider rows the project appears to have. */
let mockProviders: Array<Record<string, unknown>> = [];

const createMock = vi.fn();
const updateMock = vi.fn();
const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

/** Overridden per test to simulate ?drawer.talk=1 from the card menu (#23). */
let mockDrawerParams: Record<string, string | undefined> = {};

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  useDrawerParams: () => mockDrawerParams,
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: () => ({
          data: mockAgentById,
          isLoading: false,
          error: null,
        }),
      },
      getAll: { invalidate: vi.fn() },
      create: {
        useMutation: () => ({ mutate: createMock, isPending: false }),
      },
      update: {
        useMutation: () => ({ mutate: updateMock, isPending: false }),
      },
    },
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: { providers: mockProviders, modelMetadata: {} },
          isLoading: false,
          error: null,
        }),
      },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

// -- Helpers --

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderVoiceDrawer(
  props: Partial<Parameters<typeof AgentVoiceEditorDrawer>[0]> = {},
) {
  return render(<AgentVoiceEditorDrawer open={true} {...props} />, {
    wrapper: Wrapper,
  });
}

const ELEVENLABS_KEYED_PROVIDER = {
  provider: "elevenlabs",
  enabled: true,
  customKeys: { ELEVENLABS_API_KEY: "***" },
};

// -- Tests --

describe("AgentVoiceEditorDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentById = null;
    mockProviders = [];
    mockVoiceAgentsEnabled = true;
    mockPhoneTargetsEnabled = false;
    mockDrawerParams = {};
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });
  afterEach(cleanup);

  describe("given the release_voice_agents_enabled flag is off", () => {
    /** @scenario "The voice agent editor shows a disabled message when opened with the flag off" */
    it("shows a disabled message instead of the editor", async () => {
      mockVoiceAgentsEnabled = false;
      renderVoiceDrawer();
      expect(
        await screen.findByTestId("voice-agents-disabled-message"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("voice-agent-name-input"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the phone targets flag gates the Phone number option", () => {
    /** @scenario "The phone option is hidden until the phone targets flag is on" */
    it("hides the Phone number option while off and offers it once on", async () => {
      mockPhoneTargetsEnabled = false;
      const { unmount } = renderVoiceDrawer();
      await screen.findByTestId("voice-agent-transport-select");
      expect(
        screen.queryByRole("option", { name: "Phone number" }),
      ).not.toBeInTheDocument();
      unmount();

      mockPhoneTargetsEnabled = true;
      renderVoiceDrawer();
      await screen.findByTestId("voice-agent-transport-select");
      expect(
        screen.getByRole("option", { name: "Phone number" }),
      ).toBeInTheDocument();
    });

    it("still renders an existing phone target's fields with the flag off", async () => {
      mockPhoneTargetsEnabled = false;
      mockAgentById = {
        id: "agent_phone",
        name: "Hotline",
        config: { transport: "phone", phoneNumber: "+14155550123" },
      };
      renderVoiceDrawer({ agentId: "agent_phone" });
      const input = (await screen.findByTestId(
        "voice-agent-phone-input",
      )) as HTMLInputElement;
      expect(input.value).toBe("+14155550123");
      expect(
        screen.getByRole("option", { name: "Phone number" }),
      ).toBeInTheDocument();
    });

    it("never persists the typed phone number in the sessionStorage draft", async () => {
      mockPhoneTargetsEnabled = true;
      const user = userEvent.setup();
      renderVoiceDrawer();
      await user.type(
        await screen.findByTestId("voice-agent-name-input"),
        "Hotline draft",
      );
      await user.selectOptions(
        screen.getByTestId("voice-agent-transport-select"),
        "phone",
      );
      await user.type(
        await screen.findByTestId("voice-agent-phone-input"),
        "+14155550123",
      );

      await waitFor(() => {
        expect(
          sessionStorage.getItem("voice-agent-draft:test-project"),
        ).not.toBeNull();
      });
      const stored = JSON.parse(
        sessionStorage.getItem("voice-agent-draft:test-project") ?? "{}",
      ) as Record<string, unknown>;
      // The sensitive field is stripped; the rest of the draft still persists.
      expect(stored).not.toHaveProperty("phoneNumber");
      expect(JSON.stringify(stored)).not.toContain("+14155550123");
      expect(stored.name).toBe("Hotline draft");
      expect(stored.transport).toBe("phone");
    });
  });

  describe("when a new voice agent drawer is drawn", () => {
    it("renders Name, Reached via (transport preselected) and Agent id", async () => {
      renderVoiceDrawer();
      await waitFor(() => {
        expect(
          screen.getByTestId("voice-agent-name-input"),
        ).toBeInTheDocument();
      });
      const transport = screen.getByTestId(
        "voice-agent-transport-select",
      ) as HTMLSelectElement;
      expect(transport.value).toBe("elevenlabs_convai");
      expect(screen.getByTestId("voice-agent-id-input")).toBeInTheDocument();
    });

    it("shows inline errors and does not save when Name and Agent id are empty", async () => {
      const user = userEvent.setup();
      renderVoiceDrawer();
      const save = await screen.findByTestId("save-agent-button");
      expect(save).toBeEnabled();

      await user.click(save);

      expect(screen.getByText("Name is required")).toBeInTheDocument();
      expect(screen.getByText("Agent id is required")).toBeInTheDocument();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("creates with type voice and a trimmed agent id", async () => {
      const user = userEvent.setup();
      renderVoiceDrawer();
      await user.type(
        screen.getByTestId("voice-agent-name-input"),
        "Support line",
      );
      await user.type(
        screen.getByTestId("voice-agent-id-input"),
        "  agent_123  ",
      );
      await user.click(screen.getByTestId("save-agent-button"));

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "voice",
          config: { transport: "elevenlabs_convai", agentId: "agent_123" },
        }),
      );
    });

    describe("when the project has no ElevenLabs key", () => {
      it("shows the no-key callout with an Add key link", async () => {
        renderVoiceDrawer();
        await waitFor(() => {
          expect(
            screen.getByText("No ElevenLabs key in this project"),
          ).toBeInTheDocument();
        });
        expect(screen.getByTestId("voice-agent-add-key")).toBeInTheDocument();
      });
    });

    describe("when the project has an ElevenLabs key", () => {
      it("shows the provider line and no Add key link", async () => {
        mockProviders = [ELEVENLABS_KEYED_PROVIDER];
        renderVoiceDrawer();
        await waitFor(() => {
          expect(
            screen.getByText("Using the ElevenLabs provider key"),
          ).toBeInTheDocument();
        });
        expect(
          screen.queryByTestId("voice-agent-add-key"),
        ).not.toBeInTheDocument();
      });
    });

    it("restores the draft from sessionStorage on mount", async () => {
      sessionStorage.setItem(
        "voice-agent-draft:test-project",
        JSON.stringify({
          name: "Draft name",
          transport: "elevenlabs_convai",
          agentId: "agent_draft",
        }),
      );
      renderVoiceDrawer();
      await waitFor(() => {
        expect(
          (screen.getByTestId("voice-agent-name-input") as HTMLInputElement)
            .value,
        ).toBe("Draft name");
      });
      expect(
        (screen.getByTestId("voice-agent-id-input") as HTMLInputElement).value,
      ).toBe("agent_draft");
    });

    /** @scenario "Talk to it is disabled until the agent id is filled" */
    it("disables Talk to it until the agent id is filled, then enables it without saving", async () => {
      const user = userEvent.setup();
      mockProviders = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer();

      const talk = await screen.findByTestId("voice-agent-talk");
      expect(talk).toBeDisabled();
      expect(talk).toHaveAttribute("title", "Enter the agent id first");

      await user.type(screen.getByTestId("voice-agent-id-input"), "agent_1");
      expect(talk).toBeEnabled();
    });
  });

  describe("when Talk to it has already created the agent row for a new draft", () => {
    it("updates the created row instead of inserting a duplicate on Save", async () => {
      const user = userEvent.setup();
      mockProviders = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer();

      await user.type(screen.getByTestId("voice-agent-name-input"), "Support");
      await user.type(screen.getByTestId("voice-agent-id-input"), "agent_1");
      await user.click(await screen.findByTestId("voice-agent-talk"));

      await user.click(await screen.findByTestId("mock-panel-created-row"));
      await user.click(screen.getByTestId("save-agent-button"));

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "agent_row_created" }),
      );
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("given the card menu opened Talk to it directly (?drawer.talk=1)", () => {
    /** @scenario "Talk to it appears on a voice agent's card menu while the flag is on" */
    it("opens the drawer with the call panel already visible", async () => {
      mockAgentById = {
        id: "voice_1",
        name: "Support line",
        config: { transport: "elevenlabs_convai", agentId: "agent_1" },
      };
      mockProviders = [ELEVENLABS_KEYED_PROVIDER];
      mockDrawerParams = { agentId: "voice_1", talk: "1" };
      renderVoiceDrawer({ agentId: "voice_1" });

      expect(
        await screen.findByTestId("mock-panel-created-row"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("voice-agent-name-input"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a saved phone target", () => {
    /** @scenario "A phone target's drawer explains why Talk to it is off" */
    it("disables Talk to it with the phone-has-no-browser-call tooltip", async () => {
      mockAgentById = {
        id: "agent_phone",
        name: "Hotline",
        config: { transport: "phone", phoneNumber: "+14155550123" },
      };
      mockProviders = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer({ agentId: "agent_phone" });
      const talk = await screen.findByTestId("voice-agent-talk");
      expect(talk).toBeDisabled();
      expect(talk).toHaveAttribute(
        "title",
        "Browser calls are not available for phone targets. Call it from a scenario run.",
      );
    });
  });

  describe("when the saved agent's project has no ElevenLabs key", () => {
    /** @scenario "Talk to it is disabled when the project has no ElevenLabs key" */
    it("disables Talk to it with the tooltip 'Add an ElevenLabs key first'", async () => {
      mockAgentById = {
        id: "voice_1",
        name: "Support line",
        config: { transport: "elevenlabs_convai", agentId: "agent_1" },
      };
      mockProviders = [];
      renderVoiceDrawer({ agentId: "voice_1" });
      const talk = await screen.findByTestId("voice-agent-talk");
      expect(talk).toBeDisabled();
      expect(talk).toHaveAttribute("title", "Add an ElevenLabs key first");
    });
  });
});
