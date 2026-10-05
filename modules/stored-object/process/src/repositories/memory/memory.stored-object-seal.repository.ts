import { StoredObjectSealRepository } from "../stored-object-seal.repository.ts";

/** The memory twin seals in plaintext: tests read what a URL carries, not the cipher. */
export class MemoryStoredObjectSealRepository extends StoredObjectSealRepository {
  static create(): MemoryStoredObjectSealRepository {
    return new MemoryStoredObjectSealRepository();
  }

  private constructor() {
    super();
  }

  seal(claims: string): string {
    return claims;
  }

  open(seal: string): string {
    return seal;
  }
}
