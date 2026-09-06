/**
 * @vitest-environment node
 *
 * Integration tests for the agent write paths that never touch the tRPC
 * router: copyAgent, syncFromSource and pushToCopies.
 *
 * These are the paths that made issue #3013's save-side fix incomplete while
 * normalization lived in the router — each one reaches the same column with the
 * same un-normalized config, and copyAgent propagates legacy indented configs
 * into new projects. The source rows here are written straight through Prisma
 * so they carry the indentation a legacy record actually has.
 */
import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { AgentService } from "../agent.service";

/**
 * Python source carrying the same uniform indent on every line — what an
 * editor's auto-indent-on-paste produces, and what crashes the code-block
 * runner's compile() with IndentationError (issue #3013).
 */
const INDENTED_CODE =
  '  class Code:\n      def __call__(self, input):\n          return {"output": input.upper()}\n';
const FLUSH_CODE =
  'class Code:\n    def __call__(self, input):\n        return {"output": input.upper()}\n';

const codeConfigWith = (value: string) => ({
  name: "Python Processor",
  parameters: [{ identifier: "code", type: "code", value }],
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
});

const codeValueOf = (config: unknown): string | undefined => {
  const parameters = (
    config as { parameters?: { identifier: string; value?: unknown }[] }
  ).parameters;
  const parameter = parameters?.find((p) => p.identifier === "code");
  return typeof parameter?.value === "string" ? parameter.value : undefined;
};

const copyWorkflowNeverCalled = {
  copyWorkflow: () => {
    throw new Error("copyWorkflow must not be called for a code agent");
  },
};

describe("Feature: code-agent indentation normalization on non-router write paths", () => {
  let organization: Organization;
  let team: Team;
  let sourceProject: Project;
  let targetProject: Project;
  let service: AgentService;

  /** Writes a row directly, bypassing the repository — a pre-existing record. */
  async function seedAgent(input: {
    projectId: string;
    code: string;
    copiedFromAgentId?: string;
  }) {
    return prisma.agent.create({
      data: {
        id: `agent_${nanoid()}`,
        name: "Python Processor",
        projectId: input.projectId,
        type: "code",
        config: codeConfigWith(input.code),
        ...(input.copiedFromAgentId && {
          copiedFromAgentId: input.copiedFromAgentId,
        }),
      },
    });
  }

  const storedConfigOf = async (agentId: string) =>
    (await prisma.agent.findFirstOrThrow({ where: { id: agentId } })).config;

  beforeEach(async () => {
    organization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    sourceProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    targetProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    service = AgentService.create(prisma);
  });

  afterEach(async () => {
    const projectIds = [sourceProject.id, targetProject.id];
    // Break the self-referential AgentCopies relation before deleting, or the
    // parent row's delete is rejected while a copy still points at it.
    await prisma.agent.updateMany({
      where: { projectId: { in: projectIds } },
      data: { copiedFromAgentId: null },
    });
    await prisma.agent.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({
      where: { id: { in: [sourceProject.id, targetProject.id] } },
    });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  describe("given a legacy code agent whose stored source is uniformly indented", () => {
    describe("when it is copied into another project", () => {
      it("writes the copy's code dedented to flush", async () => {
        const source = await seedAgent({
          projectId: sourceProject.id,
          code: INDENTED_CODE,
        });

        const copied = await service.copyAgent(
          {
            sourceAgentId: source.id,
            sourceProjectId: sourceProject.id,
            targetProjectId: targetProject.id,
            newAgentId: `agent_${nanoid()}`,
          },
          copyWorkflowNeverCalled,
        );

        expect(codeValueOf(await storedConfigOf(copied.id))).toBe(FLUSH_CODE);
      });
    });

    describe("when a copy syncs from it", () => {
      it("writes the copy's code dedented to flush", async () => {
        const source = await seedAgent({
          projectId: sourceProject.id,
          code: INDENTED_CODE,
        });
        const copy = await seedAgent({
          projectId: targetProject.id,
          code: FLUSH_CODE,
          copiedFromAgentId: source.id,
        });

        await service.syncFromSource(copy.id, targetProject.id);

        expect(codeValueOf(await storedConfigOf(copy.id))).toBe(FLUSH_CODE);
      });
    });

    describe("when it is pushed to its copies", () => {
      it("writes each copy's code dedented to flush", async () => {
        const source = await seedAgent({
          projectId: sourceProject.id,
          code: INDENTED_CODE,
        });
        const copy = await seedAgent({
          projectId: targetProject.id,
          code: FLUSH_CODE,
          copiedFromAgentId: source.id,
        });

        await service.pushToCopies(source.id, sourceProject.id);

        expect(codeValueOf(await storedConfigOf(copy.id))).toBe(FLUSH_CODE);
      });
    });
  });
});
