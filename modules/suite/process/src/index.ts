export { RedisSuiteRunProcessingRepository } from "./repositories/redis/redis.suite-run-processing.repository.ts";
export { SuiteExecutionService } from "./services/suite-execution.service.ts";
export type { SuiteRunProcessingPipeline } from "./eventing/suite-run-processing.pipeline.ts";
export { suiteProcessModule } from "./suite.module.ts";

// Restored: these names have consumers outside this module.
export { type SuiteRunCommands, SuiteModule } from "./app/suite.app.ts";
export { PostgresSuiteRepositories } from "./repositories/prisma/prisma.suite.repositories.ts";
