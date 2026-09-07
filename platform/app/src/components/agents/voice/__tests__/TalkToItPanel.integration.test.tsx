/**
 * @vitest-environment jsdom
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the transport client registry so no vendor SDK is loaded in the test.
const { openCall } = vi.hoisted(() => ({
  openCall: vi.fn(async () => ({ hangUp: vi.fn(async () => {}) })),
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

  describe("when the microphone is denied", () => {
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
