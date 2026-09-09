import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import { MemoryModelCostRepository } from "./memory.model-cost.repository.ts";
import { MemoryModelDefaultRepository } from "./memory.model-default.repository.ts";
import { MemoryModelProviderDatabase } from "./memory.model-provider.database.ts";
import { MemoryModelProviderEvidenceRepository } from "./memory.model-provider-evidence.repository.ts";
import { MemoryModelProviderRepository } from "./memory.model-provider.repository.ts";

/**
 * The four twins over one store. No credential codec: nothing is encoded on
 * the way in, so a test reads back exactly the credential it wrote.
 */
export class MemoryModelProviderRepositories {
  static readonly requires = [] as const;

  static create(): ModelProviderRepositories {
    const database = MemoryModelProviderDatabase.create();

    return {
      providers: MemoryModelProviderRepository.create({ database }),
      defaults: MemoryModelDefaultRepository.create({ database }),
      costs: MemoryModelCostRepository.create({ database }),
      evidence: MemoryModelProviderEvidenceRepository.create({ database }),
    };
  }
}
