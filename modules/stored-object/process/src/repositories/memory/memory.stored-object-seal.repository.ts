import { randomBytes } from "node:crypto";

import { aesEncryption } from "@langwatch/process-stores";
import type { Encryption } from "@langwatch/process-stores/members";

import { StoredObjectSealRepository } from "../stored-object-seal.repository.ts";

/** One random key per process: every twin here opens what another sealed, nothing else does. */
const PROCESS_SEAL_KEY = randomBytes(32);

/** The memory twin seals as the live one does, under the process's random key, never plaintext. */
export class MemoryStoredObjectSealRepository extends StoredObjectSealRepository {
  static create(): MemoryStoredObjectSealRepository {
    return new MemoryStoredObjectSealRepository(aesEncryption(PROCESS_SEAL_KEY));
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
