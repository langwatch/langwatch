/**
 * @vitest-environment node
 *
 * {@link AgentService.createVoiceAgent} against a real database: a retried
 * drawer finish for an unsaved agent reuses the one row, and two finishes
 * racing the same not-yet-saved agent still settle on one row (#8020,
 * decision 1). The unit test covers the same contract against a mocked
 * repository; this proves it against Postgres's own unique constraint.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "~/utils/testUtils";
import { AgentService } from "../agent.service";
import { voiceAgentIdentityKey } from "../voice/voice-agent.config";

const projectId = `test-voice-agent-${nanoid(8)}`;

const service = AgentService.create(prisma);

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["agent", { projectId }],
    ["project", { id: projectId }],
  ]);
});

describe("AgentService.createVoiceAgent", () => {
  describe("when the same voice identity registers twice", () => {
    /** @scenario "A retried drawer finish for an unsaved agent reuses the one agent row" */
    it("reuses the same row instead of creating a second", async () => {
      const agentExternalId = `el_agent_${nanoid(6)}`;
      const input = {
        id: `agent_${nanoid()}`,
        projectId,
        name: "Support line",
        transport: "elevenlabs_convai" as const,
        agentId: agentExternalId,
      };

      const first = await service.createVoiceAgent(input);
      const second = await service.createVoiceAgent({
        ...input,
        id: `agent_${nanoid()}`,
      });

      expect(second.id).toBe(first.id);
      const identityKey = voiceAgentIdentityKey({
        transport: input.transport,
        agentExternalId,
      });
      const rows = await prisma.agent.findMany({
        where: { projectId, identityKey },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("when two finishes race to create the same unsaved agent", () => {
    /** @scenario "A retried drawer finish for an unsaved agent reuses the one agent row" */
    it("settles on one row under a concurrent double create", async () => {
      const agentExternalId = `el_agent_${nanoid(6)}`;
      const input = {
        projectId,
        name: "Support line",
        transport: "elevenlabs_convai" as const,
        agentId: agentExternalId,
      };

      const [first, second] = await Promise.all([
        service.createVoiceAgent({ ...input, id: `agent_${nanoid()}` }),
        service.createVoiceAgent({ ...input, id: `agent_${nanoid()}` }),
      ]);

      expect(second.id).toBe(first.id);
      const identityKey = voiceAgentIdentityKey({
        transport: input.transport,
        agentExternalId,
      });
      const rows = await prisma.agent.findMany({
        where: { projectId, identityKey },
      });
      expect(rows).toHaveLength(1);
    });
  });
});
