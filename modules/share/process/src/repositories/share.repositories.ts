import type { ShareGrantRepository } from "./share-grant.repository.ts";
import type { ShareRepository } from "./share.repository.ts";

export interface ShareRepositories {
  readonly shares: ShareRepository;
  readonly grants: ShareGrantRepository;
}
