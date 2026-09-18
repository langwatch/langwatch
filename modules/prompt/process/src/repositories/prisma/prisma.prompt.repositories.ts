import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { PromptRepositories } from "../prompt.repositories.ts";
import { PrismaPromptTagAssignmentRepository } from "./prisma.prompt-tag-assignment.repository.ts";
import { PrismaPromptTagRepository } from "./prisma.prompt-tag.repository.ts";
import { PrismaLlmConfigRepository } from "./prisma.prompt.repository.ts";

type PromptDatabase = Pick<
  PrismaClient,
  | "llmPromptConfig"
  | "llmPromptConfigVersion"
  | "project"
  | "promptTag"
  | "promptTagAssignment"
  | "$transaction"
>;

/** The PostgreSQL bundle keeps all Prompt repositories on one client. */
export class PostgresPromptRepositories {
  static readonly requires = ["prisma"] as const;

  static create({ prisma }: { prisma: PromptDatabase }): PromptRepositories {
    const configs = PrismaLlmConfigRepository.create({ prisma });

    return {
      configs,
      tags: PrismaPromptTagRepository.create({ prisma }),
      tagAssignments: PrismaPromptTagAssignmentRepository.create({ prisma }),
    };
  }
}
