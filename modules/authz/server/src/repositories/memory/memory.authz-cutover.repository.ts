import { AuthzCutoverRepository, type AuthzCutoverRow } from "../authz-cutover.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The cutover state a process without a database keeps, written by tests. */
export class MemoryAuthzCutoverRepository extends AuthzCutoverRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzCutoverRepository {
    return new MemoryAuthzCutoverRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findCutover({ organizationId }: { organizationId: string }): Promise<AuthzCutoverRow | null> {
    const row = this.memory.cutovers.get(organizationId);
    return row ? { status: row.status, occurredAt: row.occurredAt } : null;
  }
}
