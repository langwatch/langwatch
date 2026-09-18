import type { ApiKeyRepository } from "./api-key.repository.ts";

/**
 * The persistence one API-key application is built over. One aggregate,
 * one repository: a key and its role bindings are read and written
 * together, so splitting them would just be two objects saying the same thing.
 */
export interface ApiKeyRepositories {
  readonly apiKeys: ApiKeyRepository;
}
