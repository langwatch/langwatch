import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import type { IdentifierFact } from "@langwatch/identity-contract";

import type { ProvisionalHeadsWriter } from "../../eventing/identity-ledger.store.ts";
import type { IdentityFoldState } from "../../eventing/identity-state.projection.ts";
import { MemoryStateProjectionRepository } from "./memory.state-projection.repository.ts";

/** The identity fold's memory twin, with the provisional write the Prisma projection carries. */
export class MemoryIdentityProjectionRepository
  implements StateProjectionStore<IdentityFoldState>, ProvisionalHeadsWriter
{
  static create(): MemoryIdentityProjectionRepository {
    return new MemoryIdentityProjectionRepository();
  }

  private readonly folds = MemoryStateProjectionRepository.create<IdentityFoldState>();
  /** Rows written before a first fold, kept apart because they carry no cursor. */
  readonly provisional = new Map<string, IdentifierFact>();

  private constructor() {}

  get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<IdentityFoldState>> {
    return this.folds.get(key, context);
  }

  store(
    projection: StoredProjection<IdentityFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    return this.folds.store(projection, context);
  }

  async writeProvisionalHeads({ facts }: { facts: IdentifierFact[] }): Promise<void> {
    for (const fact of facts) this.provisional.set(fact.identifierId, fact);
  }
}
