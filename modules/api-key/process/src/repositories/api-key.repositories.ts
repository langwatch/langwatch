import type { AgentSandboxKeyRepository } from "./agent-sandbox-key.repository.ts";
import type { ApiKeyAnswerCacheRepository } from "./api-key-answer-cache.repository.ts";
import type { ApiKeyRepository } from "./api-key.repository.ts";

/**
 * The persistence one API-key application is built over. One aggregate,
 * one repository: a key and its role bindings are read and written
 * together, so splitting them would just be two objects saying the same thing.
 */
export interface ApiKeyRepositories {
  readonly apiKeys: ApiKeyRepository;
  /** The token answers every pod shares; Postgres stays the truth. */
  readonly answers: ApiKeyAnswerCacheRepository;
  /** The token each project's code agent runs share, sealed at rest on the live tier. */
  readonly sandboxKeys: AgentSandboxKeyRepository;
}
