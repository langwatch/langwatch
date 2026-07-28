import { describe, it, expect, vi } from "vitest";
import {
  type AgentComponentConfig,
  AgentRepository,
} from "../agent.repository";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(findFirstResult: unknown = null) {
  return {
    agent: {
      findFirst: vi.fn(() => Promise.resolve(findFirstResult)),
    },
  } as unknown as PrismaClient;
}

/**
 * Python source that carries the same uniform indent on every line — what an
 * editor's auto-indent-on-paste produces, and what crashes the code-block
 * runner's compile() with IndentationError (issue #3013).
 */
const INDENTED_CODE =
  '  class Code:\n      def __call__(self, input):\n          return {"output": input.upper()}\n';
const FLUSH_CODE =
  'class Code:\n    def __call__(self, input):\n        return {"output": input.upper()}\n';

const codeConfigWith = (value: string): AgentComponentConfig =>
  ({
    name: "Python Processor",
    parameters: [{ identifier: "code", type: "code", value }],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  }) as AgentComponentConfig;

const codeValueOf = (config: unknown): string | undefined => {
  const parameters = (
    config as { parameters?: { identifier: string; value?: unknown }[] }
  ).parameters;
  const parameter = parameters?.find((p) => p.identifier === "code");
  return typeof parameter?.value === "string" ? parameter.value : undefined;
};

/**
 * Prisma double that echoes the written row back, so the repository's own
 * parse-on-return succeeds and the test can assert on the persisted payload.
 */
function makeWriteMockPrisma(existing?: { type: string; config?: unknown }) {
  const row = (type: string, config: unknown) => ({
    id: "agent_1",
    projectId: "proj_1",
    name: "Python Processor",
    type,
    config,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  const create = vi.fn((args: { data: { type: string; config: unknown } }) =>
    Promise.resolve(row(args.data.type, args.data.config)),
  );
  const update = vi.fn((args: { data: { type?: string; config?: unknown } }) =>
    Promise.resolve(
      row(
        args.data.type ?? existing?.type ?? "code",
        args.data.config ?? existing?.config ?? codeConfigWith(FLUSH_CODE),
      ),
    ),
  );
  const findFirst = vi.fn(() =>
    Promise.resolve(
      existing
        ? row(existing.type, existing.config ?? codeConfigWith(FLUSH_CODE))
        : null,
    ),
  );

  return {
    prisma: { agent: { create, update, findFirst } } as unknown as PrismaClient,
    create,
    update,
  };
}

describe("AgentRepository", () => {
  describe("exists()", () => {
    describe("when agent exists and is not archived", () => {
      it("returns true", async () => {
        const prisma = makeMockPrisma({ id: "agent_1" });
        const repository = new AgentRepository(prisma);

        const result = await repository.exists({ id: "agent_1", projectId: "proj_1" });

        expect(result).toBe(true);
      });

      it("queries with archivedAt: null", async () => {
        const prisma = makeMockPrisma({ id: "agent_1" });
        const repository = new AgentRepository(prisma);

        await repository.exists({ id: "agent_1", projectId: "proj_1" });

        expect(prisma.agent.findFirst).toHaveBeenCalledWith({
          where: { id: "agent_1", projectId: "proj_1", archivedAt: null },
          select: { id: true },
        });
      });
    });

    describe("when agent does not exist", () => {
      it("returns false", async () => {
        const prisma = makeMockPrisma(null);
        const repository = new AgentRepository(prisma);

        const result = await repository.exists({ id: "agent_missing", projectId: "proj_1" });

        expect(result).toBe(false);
      });
    });
  });

  /**
   * The repository is the single chokepoint every write path funnels through
   * (tRPC router, REST POST/PATCH, copyAgent, syncFromSource, pushToCopies).
   * These pin the normalization to that altitude — a route-level fix passes the
   * router tests and still leaves every other caller writing indented code.
   */
  describe("code-agent indentation normalization (issue #3013)", () => {
    describe("given uniformly-indented Python source", () => {
      describe("when creating a code agent", () => {
        it("persists the code dedented to flush", async () => {
          const { prisma, create } = makeWriteMockPrisma();
          const repository = new AgentRepository(prisma);

          await repository.create({
            id: "agent_1",
            projectId: "proj_1",
            name: "Python Processor",
            type: "code",
            config: codeConfigWith(INDENTED_CODE),
          });

          expect(codeValueOf(create.mock.calls[0]![0].data.config)).toBe(
            FLUSH_CODE,
          );
        });
      });

      describe("when updating a code agent", () => {
        it("persists the code dedented to flush", async () => {
          const { prisma, update } = makeWriteMockPrisma({ type: "code" });
          const repository = new AgentRepository(prisma);

          await repository.update({
            id: "agent_1",
            projectId: "proj_1",
            data: { config: codeConfigWith(INDENTED_CODE) },
          });

          expect(codeValueOf(update.mock.calls[0]![0].data.config)).toBe(
            FLUSH_CODE,
          );
        });
      });

      describe("when writing via updateNameAndConfig (syncFromSource / pushToCopies)", () => {
        it("persists the code dedented to flush", async () => {
          const { prisma, update } = makeWriteMockPrisma({ type: "code" });
          const repository = new AgentRepository(prisma);

          await repository.updateNameAndConfig("agent_1", "proj_1", {
            name: "Python Processor",
            config: codeConfigWith(INDENTED_CODE),
          });

          expect(codeValueOf(update.mock.calls[0]![0].data.config)).toBe(
            FLUSH_CODE,
          );
        });
      });
    });

    describe("given already-flush Python source", () => {
      describe("when creating a code agent", () => {
        it("stores it byte-identically", async () => {
          const { prisma, create } = makeWriteMockPrisma();
          const repository = new AgentRepository(prisma);

          await repository.create({
            id: "agent_1",
            projectId: "proj_1",
            name: "Python Processor",
            type: "code",
            config: codeConfigWith(FLUSH_CODE),
          });

          expect(codeValueOf(create.mock.calls[0]![0].data.config)).toBe(
            FLUSH_CODE,
          );
        });
      });
    });

    describe("given non-uniformly-indented Python source", () => {
      describe("when creating a code agent", () => {
        it("leaves the source untouched", async () => {
          const nonUniform = "if True:\n        x = 1\n  y = 2\n";
          const { prisma, create } = makeWriteMockPrisma();
          const repository = new AgentRepository(prisma);

          await repository.create({
            id: "agent_1",
            projectId: "proj_1",
            name: "Python Processor",
            type: "code",
            config: codeConfigWith(nonUniform),
          });

          expect(codeValueOf(create.mock.calls[0]![0].data.config)).toBe(
            nonUniform,
          );
        });
      });
    });

    describe("given a non-code agent carrying a code-shaped parameter", () => {
      describe("when creating it", () => {
        it("leaves the parameter untouched", async () => {
          const { prisma, create } = makeWriteMockPrisma();
          const repository = new AgentRepository(prisma);

          await repository.create({
            id: "agent_1",
            projectId: "proj_1",
            name: "Signature Agent",
            type: "signature",
            config: {
              prompt: "You are a helpful assistant",
              parameters: [
                { identifier: "code", type: "code", value: INDENTED_CODE },
              ],
            } as unknown as AgentComponentConfig,
          });

          expect(codeValueOf(create.mock.calls[0]![0].data.config)).toBe(
            INDENTED_CODE,
          );
        });
      });
    });
  });
});
