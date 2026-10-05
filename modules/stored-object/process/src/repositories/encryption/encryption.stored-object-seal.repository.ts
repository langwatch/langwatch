import type { Encryption } from "@langwatch/process-stores/members";

import { StoredObjectSealRepository } from "../stored-object-seal.repository.ts";

/** Seals with the process's `encryption` store, as model-provider's credentials are. */
export class EncryptionStoredObjectSealRepository extends StoredObjectSealRepository {
  static create(encryption: Encryption): EncryptionStoredObjectSealRepository {
    return new EncryptionStoredObjectSealRepository(encryption);
  }

  private constructor(private readonly encryption: Encryption) {
    super();
  }

  seal(claims: string): string {
    return this.encryption.encrypt(claims);
  }

  open(seal: string): string {
    return this.encryption.decrypt(seal);
  }
}
