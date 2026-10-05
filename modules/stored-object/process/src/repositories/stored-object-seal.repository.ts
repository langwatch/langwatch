/**
 * Seals the claims an upload or read URL carries, and opens them again. The
 * live seal is the `encryption` store (AES-256-GCM, whose seal is its own
 * signature); `open` throws on a seal it did not make. ADR-158 §4.
 */
export abstract class StoredObjectSealRepository {
  abstract seal(claims: string): string;
  abstract open(seal: string): string;
}
