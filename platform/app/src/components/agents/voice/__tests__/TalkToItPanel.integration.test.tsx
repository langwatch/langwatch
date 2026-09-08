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

  describe("when the provider disconnects after several transcript turns", () => {
    it("posts the full transcript to finish, not an empty one", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const finishCalls: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith("/api/voice/session")) {
          return json({
            transport: "elevenlabs_convai",
            sessionToken: "signed.token",
            maxDurationSeconds: 300,
            connect: { signedUrl: "wss://x" },
          });
        }
        if (href.includes("/finish")) {
          finishCalls.push(
            JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          );
          return json({
            runId: "voicecall_x",
            agentId: "agent_1",
            source: "provider",
            fetchFailed: false,
            hasAudio: false,
          });
        }
        return json({});
      });
      vi.stubGlobal("fetch", fetchMock);

      let disconnect: (() => void) | undefined;
      openCall.mockImplementationOnce(
        async ({
          handlers,
        }: {
          handlers: {
            onConnected: (i: { conversationId: string }) => void;
            onTranscript: (turn: { role: string; text: string }) => void;
            onDisconnect: () => void;
          };
        }) => {
          handlers.onConnected({ conversationId: "conv_1" });
          handlers.onTranscript({
            role: "agent",
            text: "Hello, how can I help?",
          });
          handlers.onTranscript({ role: "caller", text: "I need a refund." });
          handlers.onTranscript({ role: "agent", text: "Sure, let me check." });
          disconnect = handlers.onDisconnect;
          return { hangUp: vi.fn(async () => {}), getInputVolume: () => 0 };
        },
      );

      renderPanel();
      await screen.findByTestId("talk-hang-up");

      // The provider ends the call on its own, not via the Hang up button.
      disconnect?.();

      await waitFor(() => {
        expect(finishCalls).toHaveLength(1);
      });
      expect(finishCalls[0]?.transcript).toEqual([
        { role: "agent", text: "Hello, how can I help?" },
        { role: "caller", text: "I need a refund." },
        { role: "agent", text: "Sure, let me check." },
      ]);
    });
  });

  describe("when the panel unmounts mid-call", () => {
    // RunDialog unmounts this panel both on "Back" (setCalling(false)) and on
    // the dialog closing (subject cleared) — either way the panel itself is
    // torn down, so this exercises the one cleanup path both share (#18).
    it("hangs up the live session instead of leaving it connected", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                transport: "elevenlabs_convai",
                sessionToken: "signed.token",
                maxDurationSeconds: 300,
                connect: { signedUrl: "wss://x" },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      );
      const hangUp = vi.fn(async () => {});
      openCall.mockImplementationOnce(
        async ({
          handlers,
        }: {
          handlers: { onConnected: (i: { conversationId: string }) => void };
        }) => {
          handlers.onConnected({ conversationId: "conv_1" });
          return { hangUp, getInputVolume: () => 0 };
        },
      );

      const { unmount } = renderPanel();
      await screen.findByTestId("talk-hang-up");

      unmount();

      await waitFor(() => {
        expect(hangUp).toHaveBeenCalled();
      });
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
