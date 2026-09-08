/**
 * @vitest-environment jsdom
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceTransportClient } from "../voice-transport-client.registry";

// Mock the transport client registry so no vendor SDK is loaded in the test.
const { openCall } = vi.hoisted(() => ({
  openCall: vi.fn<VoiceTransportClient["openCall"]>(async () => ({
    hangUp: vi.fn(async () => {}),
  })),
}));
vi.mock("../voice-transport-client.registry", () => ({
  voiceTransportClientRegistry: { elevenlabs_convai: { openCall } },
}));

import { TalkToItPanel } from "../TalkToItPanel";
import { CONSENT_NOTICE, MIC_DENIED_MESSAGE } from "../talkToItMachine";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderPanel() {
  return render(
    <TalkToItPanel
      projectId="p1"
      projectSlug="proj"
      transport="elevenlabs_convai"
      agentId="agent_1"
    />,
    { wrapper: Wrapper },
  );
}

describe("TalkToItPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the mint pending so the panel stays on connecting for the notice.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("when the call has not connected", () => {
    /** @scenario "The panel shows the consent and guardrails notice before the call connects" */
    it("shows the consent and guardrails notice", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      });
      renderPanel();
      await waitFor(() => {
        expect(screen.getByTestId("talk-consent-notice")).toHaveTextContent(
          CONSENT_NOTICE,
        );
      });
    });
  });

  describe("when the finished call has a recording", () => {
    /** @scenario "The finished call plays its recording through the same-origin proxy url" */
    it("plays the recording through the same-origin proxy url from finish", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
        },
      });
      const audioUrl = "/api/voice/session/conv_1/audio?projectId=p1";
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          String(url).endsWith("/api/voice/session")
            ? json({
                transport: "elevenlabs_convai",
                sessionToken: "signed.token",
                maxDurationSeconds: 300,
                connect: { signedUrl: "wss://x" },
              })
            : json({
                runId: "voicecall_x",
                agentId: "agent_1",
                source: "provider",
                fetchFailed: false,
                hasAudio: true,
                audioUrl,
              }),
        ),
      );
      // The transport reports the call connected, then hands back a session.
      openCall.mockImplementationOnce(
        async ({
          handlers,
        }: {
          handlers: { onConnected: (i: { conversationId: string }) => void };
        }) => {
          handlers.onConnected({ conversationId: "conv_1" });
          return { hangUp: vi.fn(async () => {}), getInputVolume: () => 0 };
        },
      );

      renderPanel();

      const hangUp = await screen.findByTestId("talk-hang-up");
      hangUp.click();

      const player = await screen.findByTestId("talk-play");
      expect(player.querySelector("audio")).toHaveAttribute("src", audioUrl);
    });
  });

  describe("when the microphone is denied", () => {
    /** @scenario "Microphone access denied shows a retry notice and starts no run" */
    it("shows the retry notice and never stays on connecting", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: vi.fn(async () => {
            throw new Error("denied");
          }),
        },
      });
      renderPanel();
      await waitFor(() => {
        expect(screen.getByTestId("talk-error")).toHaveTextContent(
          MIC_DENIED_MESSAGE,
        );
      });
      expect(screen.queryByText("Connecting")).not.toBeInTheDocument();
      expect(openCall).not.toHaveBeenCalled();
    });
  });
});
