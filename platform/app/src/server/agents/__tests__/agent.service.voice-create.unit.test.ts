/**
 * @vitest-environment node
 *
 * {@link AgentService.createVoiceAgent} folds a voice agent onto one row by its
 * identity key, so a first "Talk to it" hang-up before the agent is saved — or
 * two tabs racing the same not-yet-saved agent — cannot create a second row
 * (#8020, decision 1). This replaces the old run-based guard, which stopped
 * covering the drawer path once a drawer call no longer writes a run.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { voiceAgentIdentityKey } from "~/server/agents/voice/voice-agent.config";
import { AgentRepository, type TypedAgent } from "../agent.repository";
import { AgentService } from "../agent.service";

const IDENTITY_KEY = voiceAgentIdentityKey({
  transport: "elevenlabs_convai",
  agentExternalId: "el_agent_1",
});

function voiceRow(id: string): TypedAgent {
  return {
    id,
    projectId: "project_1",
    name: "Support line",
    type: "voice",
    config: { transport: "elevenlabs_convai", agentId: "el_agent_1" },
    identityKey: IDENTITY_KEY,
  } as unknown as TypedAgent;
}

const INPUT = {
  id: "agent_new",
  projectId: "project_1",
  name: "Support line",
  transport: "elevenlabs_convai" as const,
  agentId: "el_agent_1",
};

function serviceWith(repo: Partial<AgentRepository>): AgentService {
  return new AgentService(
    {} as unknown as PrismaClient,
    repo as unknown as AgentRepository,
  );
}

describe("AgentService.createVoiceAgent", () => {
  describe("given a row already exists for the identity key", () => {
    /** @scenario "A retried drawer finish for an unsaved agent reuses the one agent row" */
    it("reuses the existing row without creating a second", async () => {
      const create = vi.fn();
      const findByIdentityKey = vi.fn(async () => voiceRow("agent_existing"));
      const service = serviceWith({ findByIdentityKey, create });

      const result = await service.createVoiceAgent(INPUT);

      expect(result.id).toBe("agent_existing");
      expect(findByIdentityKey).toHaveBeenCalledWith({
        projectId: "project_1",
        identityKey: IDENTITY_KEY,
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("given no row yet for the identity key", () => {
    it("creates the row carrying that identity key", async () => {
      const findByIdentityKey = vi.fn(async () => null);
      const create = vi.fn(async () => voiceRow("agent_new"));
      const service = serviceWith({ findByIdentityKey, create });

      const result = await service.createVoiceAgent(INPUT);

      expect(result.id).toBe("agent_new");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_1",
          type: "voice",
          config: { transport: "elevenlabs_convai", agentId: "el_agent_1" },
          identityKey: IDENTITY_KEY,
        }),
      );
    });
  });

  describe("given two finishes race to create the same unsaved agent", () => {
    /** @scenario "A retried drawer finish for an unsaved agent reuses the one agent row" */
    it("reuses the winner's row on a unique-key race", async () => {
      // First lookup sees nothing; the create hits the unique constraint the
      // winner already wrote; the re-read returns the winner's row.
      const findByIdentityKey = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(voiceRow("agent_winner"));
      const create = vi.fn(async () => {
        throw { code: "P2002" };
      });
      const service = serviceWith({ findByIdentityKey, create });

      const result = await service.createVoiceAgent(INPUT);

      expect(result.id).toBe("agent_winner");
      expect(findByIdentityKey).toHaveBeenCalledTimes(2);
    });
  });
});
