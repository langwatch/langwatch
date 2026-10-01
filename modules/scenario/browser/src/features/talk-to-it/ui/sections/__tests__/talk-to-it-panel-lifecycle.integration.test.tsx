/**
 * @vitest-environment jsdom
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  VoiceCallSession,
  VoiceSessionClient,
  VoiceTransportClient,
} from "../../../model/voice-call.ts";

const { openCall } = vi.hoisted(() => ({
  openCall: vi.fn<VoiceTransportClient["openCall"]>(async () => ({
    hangUp: vi.fn(async () => {}),
  })),
}));
vi.mock("../../../behavior/voice-transport-client.registry.ts", () => ({
  getVoiceTransportClient: () => ({ openCall }),
}));

import { TalkToItPanel } from "../talk-to-it-panel.tsx";

const sessionClient: VoiceSessionClient = {
  mint: async () => ({
    transport: "elevenlabs_convai",
    sessionToken: "signed.token",
    maxDurationSeconds: 300,
    connect: { signedUrl: "wss://x" },
  }),
  finish: async () => ({
    runId: "",
    agentId: "agent_1",
    source: "provider",
    hasFetchFailed: false,
    hasAudio: false,
  }),
  describeFailure: (error) => ({ message: String(error) }),
};

function renderPanel({ strict = false }: { strict?: boolean } = {}) {
  const panel = (
    <TalkToItPanel
      sessionClient={sessionClient}
      projectId="p1"
      projectSlug="proj"
      transport="elevenlabs_convai"
      agentId="agent_1"
    />
  );
  const ui: ReactNode = (
    <ChakraProvider value={defaultSystem}>
      {strict ? <StrictMode>{panel}</StrictMode> : panel}
    </ChakraProvider>
  );
  return render(ui);
}

describe("TalkToItPanel lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });
  afterEach(cleanup);

  describe("when the panel unmounts mid-call", () => {
    it("hangs up the live session instead of leaving it connected", async () => {
      const hangUp = vi.fn(async () => {});
      openCall.mockImplementationOnce(async ({ handlers }) => {
        handlers.onConnected({ conversationId: "conv_1" });
        return { hangUp, getInputVolume: () => 0 };
      });
      const { unmount } = renderPanel();
      await screen.findByTestId("talk-hang-up");
      unmount();
      await waitFor(() => expect(hangUp).toHaveBeenCalled());
    });
  });

  describe("when the panel unmounts while a call is still connecting", () => {
    it("hangs up the session that arrives after unmount", async () => {
      const hangUp = vi.fn(async () => {});
      let resolveOpenCall: ((session: VoiceCallSession) => void) | undefined;
      openCall.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOpenCall = resolve;
          }),
      );
      const { unmount } = renderPanel();
      await waitFor(() => expect(openCall).toHaveBeenCalled());
      unmount();
      resolveOpenCall?.({ hangUp, getInputVolume: () => 0 });
      await waitFor(() => expect(hangUp).toHaveBeenCalled());
    });
  });

  describe("when the panel mounts under React Strict Mode", () => {
    it("opens exactly one call and reaches the live view", async () => {
      openCall.mockImplementation(async ({ handlers }) => {
        handlers.onConnected({ conversationId: "conv_strict" });
        return { hangUp: vi.fn(async () => {}), getInputVolume: () => 0 };
      });
      renderPanel({ strict: true });
      await waitFor(() => expect(screen.getByTestId("talk-live")).toBeInTheDocument());
      expect(openCall).toHaveBeenCalledTimes(1);
    });
  });
});
