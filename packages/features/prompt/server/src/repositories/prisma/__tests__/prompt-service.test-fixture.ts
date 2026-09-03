import {
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { vi } from "vitest";
import { PromptTagAssignmentRepository } from "../prisma.prompt-tag-assignment.repository";
import { PromptTagRepository } from "../prisma.prompt-tag.repository";
import { LlmConfigRepository } from "../prisma.prompt.repository";
import { PromptService } from "../../../services/prompt.service";
import { PromptTagService } from "../../../services/prompt-tag.service";
import { PromptVersionService } from "../../../services/prompt-version.service";

/**
 * Creates a typed client that unit tests can safely spy on without opening a
 * database connection. Persistence integration tests supply a real endpoint.
 */
class AllowAllPromptTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

function createPromptTestDatabase() {
  return PrismaConnectionService.create({
    guard: new AllowAllPromptTestQueries(),
  }).connect({
    databaseUrl: "postgresql://prompt-test:prompt-test@127.0.0.1:1/prompt_test",
    log: [],
  }).client;
}

/** Builds a composed service whose persistence methods unit tests can spy on. */
export function createPromptServiceForTest(): PromptService {
  const database = createPromptTestDatabase();
  const repository = new LlmConfigRepository(database);
  vi.spyOn(repository, "getOrganizationIdForProject").mockResolvedValue("org_test");
  vi.spyOn(repository, "checkModifyPermission").mockResolvedValue({ hasPermission: true });
  const promptTagRepository = new PromptTagRepository(database);

  return PromptService.create({
    repository,
    versionService: PromptVersionService.create(),
    tagRepository: new PromptTagAssignmentRepository(database),
    promptTagRepository,
    tagService: PromptTagService.create(promptTagRepository),
  });
}
