import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RateLimiter } from "@langwatch/process-stores";

import type { PromptRepositories } from "../prompt.repositories.ts";
import { RedisPromptRateLimitRepository } from "../redis/redis.prompt-rate-limit.repository.ts";
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
  static readonly requires = ["prisma", "rateLimiter"] as const;

  static create({
    prisma,
    rateLimiter,
  }: {
    prisma: PromptDatabase;
    rateLimiter: RateLimiter;
  }): PromptRepositories {
    const configs = PrismaLlmConfigRepository.create({ prisma });

    return {
      configs,
      tags: PrismaPromptTagRepository.create({ prisma }),
      tagAssignments: PrismaPromptTagAssignmentRepository.create({ prisma }),
      rateLimits: RedisPromptRateLimitRepository.create(rateLimiter),
    };
  }
}
