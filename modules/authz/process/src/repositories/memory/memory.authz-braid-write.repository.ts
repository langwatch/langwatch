import {
  AuthzBraidWriteRepository,
  type AuthzBraidWrite,
} from "../authz-braid-write.repository.ts";

/** The memory twin of `AuthzBraidWrite`: one write per organisation and command id. */
export class MemoryAuthzBraidWriteRepository extends AuthzBraidWriteRepository {
  readonly #writes = new Map<string, AuthzBraidWrite>();

  static create(): MemoryAuthzBraidWriteRepository {
    return new MemoryAuthzBraidWriteRepository();
  }

  async findByCommand({
    organizationId,
    commandId,
  }: {
    organizationId: string;
    commandId: string;
  }): Promise<AuthzBraidWrite[]> {
    const write = this.#writes.get(keyOf({ organizationId, commandId }));
    return write ? [write] : [];
  }

  async findIntoReader({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<AuthzBraidWrite[]> {
    return [...this.#writes.values()]
      .filter(
        (write) =>
          write.organizationId === organizationId && write.readerProjectId === readerProjectId,
      )
      .toSorted((a, b) => a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds);
  }

  async create({ write }: { write: AuthzBraidWrite }): Promise<void> {
    const key = keyOf(write);
    if (this.#writes.has(key)) {
      throw new Error(`A braid write is already recorded for command ${write.commandId}`);
    }
    this.#writes.set(key, write);
  }

  async delete(input: { organizationId: string; commandId: string }): Promise<void> {
    this.#writes.delete(keyOf(input));
  }
}

function keyOf({ organizationId, commandId }: { organizationId: string; commandId: string }) {
  return `${organizationId}:${commandId}`;
}
