/**
 * @vitest-environment jsdom
 * The lent panel mints and finishes through scenario's own tRPC procedures and reads a
 * refusal by its handled code. @see specs/features/agents/voice-agents-v1.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mintVoiceSession, finishVoiceSession, openCall } = vi.hoisted(() => ({
  mintVoiceSession: vi.fn(),
  finishVoiceSession: vi.fn(),
  openCall: vi.fn(),
}));
vi.mock("../../../../../behavior/scenario-api.ts", () => ({
  api: {
    scenarios: {
      mintVoiceSession: { useMutation: () => ({ mutateAsync: mintVoiceSession }) },
      finishVoiceSession: { useMutation: () => ({ mutateAsync: finishVoiceSession }) },
    },
  },
}));
vi.mock("../../../behavior/voice-transport-client.registry.ts", () => ({
  getVoiceTransportClient: (transport: string) =>
    transport === "elevenlabs_convai" ? { openCall } : undefined,
}));

import { NO_KEY_MESSAGE } from "../../../model/talk-to-it-machine.ts";
import { LentTalkToItPanel } from "../wired-talk-to-it-panel.tsx";

const KEY_MISSING = { code: "voice_key_missing", httpStatus: 422, fault: "customer" };

function renderLent(transport: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LentTalkToItPanel projectId="p1" projectSlug="proj" transport={transport} agentId="el_1" />
    </ChakraProvider>,
  );
}

describe("LentTalkToItPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });
  afterEach(cleanup);

  describe("when the project has no key for the transport", () => {
    /** @scenario "Talk to it is disabled when the project has no ElevenLabs key" */
    it("mints through scenarios.mintVoiceSession and names the missing key", async () => {
      mintVoiceSession.mockRejectedValue(KEY_MISSING);
      renderLent("elevenlabs_convai");

      await waitFor(() => expect(screen.getByText(NO_KEY_MESSAGE)).toBeInTheDocument());
      expect(mintVoiceSession).toHaveBeenCalledWith({
        projectId: "p1",
        transport: "elevenlabs_convai",
        agentId: "el_1",
      });
      expect(openCall).not.toHaveBeenCalled();
    });
  });

  describe("when the transport is one scenario does not know", () => {
    it("renders nothing and mints nothing", () => {
      const { container } = renderLent("carrier_pigeon");

      expect(container.querySelector("[data-testid='talk-to-it-panel']")).toBeNull();
      expect(mintVoiceSession).not.toHaveBeenCalled();
    });
  });
});
