import { createService as createRawService } from "../builder.js";

export const createTestService: typeof createRawService = ((config: Parameters<
  typeof createRawService
>[0]) =>
  createRawService(config).withoutPermission(
    "framework test endpoint",
  )) as typeof createRawService;
