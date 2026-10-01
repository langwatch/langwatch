/**
 * @vitest-environment jsdom
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { VoiceSessionFinishInput } from "@langwatch/scenario-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  VoiceCallHandlers,
  VoiceSessionClient,
  VoiceTransportClient,
} from "../../../model/voice-call.ts";

const { openCall } = vi.hoisted(() => ({
  openCall: vi.fn<VoiceTransportClient["openCall"]>(async () => ({
    hangUp: vi.fn(async () => {}),
  })),
}));
vi.mock("../../../behavior/voice-transport-client.registry.ts", () => ({
  getVoiceTransportClient: (transport: string) =>
    transport === "elevenlabs_convai" ? { openCall } : undefined,
}));

import {
  CONSENT_NOTICE,
  MIC_BLOCKED_MESSAGE,
  MIC_DENIED_MESSAGE,
  NO_KEY_MESSAGE,
} from "../../../model/talk-to-it-machine.ts";
import { PHONE_NO_BROWSER_CALL_NOTICE } from "../../../model/talk-to-it-props.ts";
import { TalkToItPanel } from "../talk-to-it-panel.tsx";

const MINTED = {
  transport: "elevenlabs_convai" as const,
  sessionToken: "signed.token",
  maxDurationSeconds: 300,
  connect: { signedUrl: "wss://x" },
};
const FINISHED = {
  runId: "",
  agentId: "agent_1",
  source: "provider" as const,
  hasFetchFailed: false,
  hasAudio: false,
};

function sessionClient(over: Partial<VoiceSessionClient> = {}): VoiceSessionClient {
  return {
    mint: vi.fn(async () => MINTED),
    finish: vi.fn(async () => FINISHED),
    describeFailure: (error) => ({
      code: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    }),
    ...over,
  };
}

function grantMic(getUserMedia = vi.fn(async () => ({ getTracks: () => [] }))) {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}

function renderPanel(
  client: VoiceSessionClient,
  transport: "elevenlabs_convai" | "phone" = "elevenlabs_convai",
) {
  const ui: ReactNode = (
    <ChakraProvider value={defaultSystem}>
      <TalkToItPanel
        sessionClient={client}
        projectId="p1"
        projectSlug="proj"
        transport={transport}
        agentId="agent_1"
      />
    </ChakraProvider>
  );
  return render(ui);
}

function connectWith(extra: (handlers: VoiceCallHandlers) => void = () => {}) {
  openCall.mockImplementationOnce(async ({ handlers }) => {
    handlers.onConnected({ conversationId: "conv_1" });
    extra(handlers);
    return { hangUp: vi.fn(async () => {}), getInputVolume: () => 0 };
  });
}

describe("TalkToItPanel", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  describe("when the call has not connected", () => {
    /** @scenario "The panel shows the consent and guardrails notice before the call connects" */
    it("shows the consent and guardrails notice", async () => {
      grantMic();
      renderPanel(sessionClient({ mint: () => new Promise(() => {}) }));
      await waitFor(() =>
        expect(screen.getByTestId("talk-consent-notice")).toHaveTextContent(CONSENT_NOTICE),
      );
    });
  });

  describe("when the transport is a phone target", () => {
    /** @scenario "A phone target has no browser call" */
    it("shows the phone notice and never opens a browser call", () => {
      const mint = vi.fn(async () => MINTED);
      renderPanel(sessionClient({ mint }), "phone");
      expect(screen.getByTestId("talk-phone-no-browser-notice")).toHaveTextContent(
        PHONE_NO_BROWSER_CALL_NOTICE,
      );
      expect(mint).not.toHaveBeenCalled();
      expect(openCall).not.toHaveBeenCalled();
    });
  });

  describe("when the finished call has a recording", () => {
    /** @scenario "The finished call plays its recording through the same-origin proxy url" */
    it("plays the recording through the proxy url finish returned, and offers no run link", async () => {
      grantMic();
      const audioUrl = "/api/voice/session/conv_1/audio?projectId=p1";
      connectWith();
      renderPanel(
        sessionClient({ finish: vi.fn(async () => ({ ...FINISHED, hasAudio: true, audioUrl })) }),
      );
      (await screen.findByTestId("talk-hang-up")).click();
      const player = await screen.findByTestId("talk-play");
      expect(player.querySelector("audio")).toHaveAttribute("src", audioUrl);
      expect(screen.queryByTestId("talk-run-link")).toBeNull();
    });
  });

  describe("when the provider disconnects after several transcript turns", () => {
    it("hands the full transcript to finish, not an empty one", async () => {
      grantMic();
      let disconnect: (() => void) | undefined;
      connectWith((handlers) => {
        handlers.onTranscript({ role: "agent", text: "Hello, how can I help?" });
        handlers.onTranscript({ role: "caller", text: "I need a refund." });
        disconnect = handlers.onDisconnect;
      });
      const finish = vi.fn(async (_input: VoiceSessionFinishInput) => FINISHED);
      renderPanel(sessionClient({ finish }));
      await screen.findByTestId("talk-hang-up");
      disconnect?.();
      await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
      expect(finish.mock.calls[0]?.[0].transcript).toEqual([
        { role: "agent", text: "Hello, how can I help?" },
        { role: "caller", text: "I need a refund." },
      ]);
    });
  });

  describe("when the project has no provider key", () => {
    it("names the missing key and offers to add one", async () => {
      grantMic();
      const refusal = Object.assign(new Error("no key"), { name: "voice_key_missing" });
      renderPanel(sessionClient({ mint: vi.fn(async () => Promise.reject(refusal)) }));
      expect(await screen.findByTestId("talk-error")).toHaveTextContent(NO_KEY_MESSAGE);
      expect(screen.getByTestId("talk-add-key")).toBeInTheDocument();
      expect(openCall).not.toHaveBeenCalled();
    });
  });

  describe("when the microphone is denied", () => {
    /** @scenario "Microphone access denied shows a retry notice and starts no run" */
    it("shows the retry notice and never stays on connecting", async () => {
      grantMic(vi.fn(async () => Promise.reject(new Error("denied"))));
      renderPanel(sessionClient());
      await waitFor(() =>
        expect(screen.getByTestId("talk-error")).toHaveTextContent(MIC_DENIED_MESSAGE),
      );
      expect(screen.queryByText("Connecting")).not.toBeInTheDocument();
      expect(openCall).not.toHaveBeenCalled();
    });
  });

  describe("when the page's Permissions-Policy blocks the microphone", () => {
    /** @scenario "A page-level microphone block is named, not reported as a denial" */
    it("names the policy, never calls getUserMedia and starts no run", async () => {
      const getUserMedia = grantMic();
      Object.defineProperty(document, "featurePolicy", {
        configurable: true,
        value: { allowsFeature: (feature: string) => feature !== "microphone" },
      });
      try {
        renderPanel(sessionClient());
        await waitFor(() =>
          expect(screen.getByTestId("talk-error")).toHaveTextContent(MIC_BLOCKED_MESSAGE),
        );
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(openCall).not.toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(document, "featurePolicy");
      }
    });
  });
});
