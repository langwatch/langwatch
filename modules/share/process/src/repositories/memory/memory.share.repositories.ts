import type { ShareRepositories } from "../share.repositories.ts";
import { MemoryShareDatabase } from "./memory.share.database.ts";
import { MemoryShareGrantRepository } from "./memory.share-grant.repository.ts";
import { MemoryShareRepository } from "./memory.share.repository.ts";

export class MemoryShareRepositories {
  static readonly requires = [] as const;

  static create(): ShareRepositories {
    const memory = MemoryShareDatabase.create();

    return {
      shares: MemoryShareRepository.create({ memory }),
      grants: MemoryShareGrantRepository.create({ memory }),
    };
  }
}
