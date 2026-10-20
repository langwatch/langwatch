import { parse } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { LATEST_SCHEMA_VERSION } from "@langwatch/prompt-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, type Mock, vi } from "vitest";

import { PrismaLlmConfigRepository } from "../prisma.prompt.repository.ts";

const config = {
  id: "prompt_existing",
  handle: "greeter",
  name: "greeter",
  scope: "PROJECT",
  projectId: "project-1",
  organizationId: "org-1",
};

const latestVersion = {
  id: "promptversion_v1",
  configId: config.id,
  projectId: config.projectId,
  version: 1,
  schemaVersion: LATEST_SCHEMA_VERSION,
  commitMessage: "Initial version",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  authorId: null,
  author: null,
  runtimeParameters: {},
  configData: {
    prompt: "hello {{input}}",
    messages: [],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    model: "openai/gpt-5-mini",
  },
};

function repositoryWithVersionCreate(create: Mock<(args: unknown) => Promise<unknown>>) {
  const prisma: PrismaClient = prismaDouble({
    $transaction: (write: unknown) => (write as (tx: PrismaClient) => unknown)(prisma),
    project: {
      findUnique: () =>
        Promise.resolve({
          id: config.projectId,
          team: { organization: { id: config.organizationId } },
        }),
    },
    llmPromptConfig: {
      findFirst: () => Promise.resolve(config),
      findUnique: () => Promise.resolve(config),
      update: () => Promise.resolve(config),
    },
    llmPromptConfigVersion: {
      findFirst: () => Promise.resolve(latestVersion),
      create,
    },
  });
  return PrismaLlmConfigRepository.create({ prisma });
}

describe("PrismaLlmConfigRepository", () => {
  describe("updateConfigAndCreateVersion()", () => {
    describe("given a prompt with a version", () => {
      /** @scenario "Updating a prompt mints the new version's id as a strict KSUID" */
      it("mints the new version's id as a promptversion KSUID", async () => {
        const create = vi.fn((args: unknown) =>
          Promise.resolve({
            ...latestVersion,
            ...(args as { data: Record<string, unknown> }).data,
            createdAt: new Date(),
          }),
        );
        const repository = repositoryWithVersionCreate(create);

        await repository.updateConfigAndCreateVersion({
          idOrHandle: config.handle,
          projectId: config.projectId,
          data: {},
          commitMessage: "v2",
          configDataUpdates: { prompt: "v2 hello {{input}}" },
          schemaVersion: LATEST_SCHEMA_VERSION,
        });

        const { data } = create.mock.calls[0]![0] as { data: { id?: string; version: number } };
        expect(data.version).toBe(2);
        expect(parse(data.id ?? "").resource).toBe("promptversion");
        expect(data.id).not.toBe(latestVersion.id);
      });
    });
  });
});
