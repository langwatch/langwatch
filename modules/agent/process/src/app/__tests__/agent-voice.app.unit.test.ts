/**
 * The voice agent a drawer finish creates, folded on its identity key.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it } from "vitest";

import { createAgentAppFixture } from "./agent.fixture.ts";

const voice = {
  projectId: "project_1",
  name: "Support line",
  transport: "elevenlabs_convai",
  agentId: "el_agent_1",
} as const;

describe("given two drawer finishes for the same never-saved voice agent", () => {
  describe("when each finish creates the voice agent row", () => {
    /** @scenario "A retried drawer finish for an unsaved agent reuses the one agent row" */
    it("folds them onto the same row rather than creating a second", async () => {
      const { app } = createAgentAppFixture();

      const first = await app.createVoiceAgent({ id: "agent_a", ...voice });
      const retried = await app.createVoiceAgent({ id: "agent_b", ...voice });

      expect(retried.id).toBe(first.id);
      await expect(
        app.hasVoiceAgentForExternalId({
          projectId: voice.projectId,
          transport: voice.transport,
          agentExternalId: voice.agentId,
        }),
      ).resolves.toBe(true);
    });
  });
});
