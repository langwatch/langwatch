import type { ShareCacheRepository } from "./share-cache.repository.ts";
import type { ShareGrantRepository } from "./share-grant.repository.ts";
import type { ShareRepository } from "./share.repository.ts";

export interface ShareRepositories {
  readonly shares: ShareRepository;
  readonly grants: ShareGrantRepository;
  readonly cache: ShareCacheRepository;
}
