import { transportsOf } from "../../rules/passkey-transports.rules.ts";
import { PasskeyRepository, type StoredPasskey } from "../passkey.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

function storedPasskey(row: Record<string, unknown>): StoredPasskey {
  return {
    id: String(row.id),
    userId: String(row.userId),
    credentialId: String(row.credentialID),
    publicKey: String(row.publicKey),
    counter: typeof row.counter === "number" ? row.counter : 0,
    transports: transportsOf(typeof row.transports === "string" ? row.transports : null),
  };
}

/** The `passkey` rows of the shared memory-adapter database; reads `db.passkey` afresh per call. */
export class MemoryPasskeyRepository extends PasskeyRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryPasskeyRepository {
    return new MemoryPasskeyRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {
    super();
  }

  async findForUser({ userId }: { userId: string }): Promise<StoredPasskey[]> {
    return this.memory.db.passkey.filter((row) => row.userId === userId).map(storedPasskey);
  }

  async findByCredentialId({ credentialId }: { credentialId: string }): Promise<StoredPasskey[]> {
    return this.memory.db.passkey
      .filter((row) => row.credentialID === credentialId)
      .map(storedPasskey);
  }

  async advanceCounter({ id, counter }: { id: string; counter: number }): Promise<void> {
    this.memory.db.passkey = this.memory.db.passkey.map((row) =>
      row.id === id && (typeof row.counter !== "number" || row.counter < counter)
        ? { ...row, counter }
        : row,
    );
  }
}
