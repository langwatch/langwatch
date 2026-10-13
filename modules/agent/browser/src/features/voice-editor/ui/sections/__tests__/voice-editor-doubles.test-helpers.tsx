/** The voice editor's module doubles, imported by each test's `vi.mock` factory. */

import { vi } from "vitest";

import type { ProviderRowReading } from "../../../model/voice-provider-keys.ts";

export const voiceState: {
  flagOn: boolean;
  agentById: { id: string; name: string; config: Record<string, unknown> } | undefined;
  providers: readonly ProviderRowReading[];
} = { flagOn: true, agentById: void 0, providers: [] };

export const createMock = vi.fn();
export const updateMock = vi.fn();

export const agentApiDouble = {
  agentApi: {
    agents: {
      getById: { useQuery: () => ({ data: voiceState.agentById, isLoading: false }) },
      create: { useMutation: () => ({ mutate: createMock, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMock, isPending: false }) },
    },
    modelProvider: {
      listAllForProjectForFrontend: { useQuery: () => ({ data: voiceState.providers }) },
    },
    useUtils: () => ({
      agents: { getAll: { invalidate: vi.fn() }, getById: { invalidate: vi.fn() } },
    }),
  },
};

export const drawerDouble = {
  useDrawer: () => ({ closeDrawer: vi.fn(), canGoBack: false, goBack: vi.fn() }),
};

/** Stands in for scenario's panel; clicking it reports a row created mid-call. */
export const talkPanelDouble = {
  TalkToItPanel: (props: { onAgentCreated?: (agentRowId: string) => void }) => (
    <button
      type="button"
      data-testid="mock-panel-created-row"
      onClick={() => props.onAgentCreated?.("agent_row_created")}
    >
      simulate created row
    </button>
  ),
};

export const ELEVENLABS_KEYED_PROVIDER = {
  provider: "elevenlabs",
  enabled: true,
  customKeys: { ELEVENLABS_API_KEY: "***" },
};

export const TWILIO_KEYED_PROVIDER = {
  provider: "twilio",
  enabled: true,
  customKeys: {
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "***",
    TWILIO_FROM_NUMBER: "+14155550000",
  },
};

export const VOICE_AGENT = {
  id: "voice_1",
  name: "Support line",
  config: { transport: "elevenlabs_convai", agentId: "agent_1" },
};

export const HOTLINE = {
  id: "agent_phone",
  name: "Hotline",
  config: { transport: "phone", phoneNumber: "+14155550123" },
};
